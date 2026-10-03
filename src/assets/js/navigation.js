(() => {
  const mainSelector = "#main";
  const parser = new DOMParser();

  const normalizePath = (url) => {
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${path}${url.search}`;
  };

  const updateHead = (nextDocument) => {
    document.title = nextDocument.title;

    [
      'meta[name="description"]',
      'link[rel="canonical"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:url"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
      'script[type="application/ld+json"]',
    ].forEach((selector) => {
      const current = document.head.querySelector(selector);
      const next = nextDocument.head.querySelector(selector);
      if (!current || !next) return;

      if (current.tagName === "LINK") {
        current.href = next.href;
        return;
      }

      if (current.tagName === "SCRIPT") {
        current.textContent = next.textContent;
        return;
      }

      current.setAttribute("content", next.getAttribute("content") || "");
    });
  };

  const updateNav = (url) => {
    const activePath = normalizePath(url);

    document.querySelectorAll(".site-nav a").forEach((link) => {
      const linkUrl = new URL(link.href);
      if (normalizePath(linkUrl) === activePath) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const runPageScripts = (container) => {
    container.querySelectorAll("script").forEach((script) => {
      const clone = document.createElement("script");
      Array.from(script.attributes).forEach((attribute) => {
        clone.setAttribute(attribute.name, attribute.value);
      });

      const type = script.getAttribute("type");
      if (!script.src && (!type || type === "text/javascript")) {
        clone.textContent = `(() => {\n${script.textContent}\n})();`;
      } else {
        clone.textContent = script.textContent;
      }

      script.replaceWith(clone);
    });
  };

  const scrollToTarget = (url) => {
    if (!url.hash) {
      window.scrollTo({ top: 0, left: 0 });
      return;
    }

    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target) {
      target.scrollIntoView();
    }
  };

  const shouldHandle = (event, link) => {
    if (event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target || link.download) return false;

    const url = new URL(link.href);
    if (url.origin !== window.location.origin) return false;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.pathname.startsWith("/assets/")) return false;
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return false;

    const current = new URL(window.location.href);
    if (
      normalizePath(url) === normalizePath(current) &&
      url.hash &&
      url.hash !== current.hash
    ) {
      return false;
    }

    return true;
  };

  const navigate = async (url, action = "push") => {
    const response = await fetch(url.href, {
      headers: { Accept: "text/html" },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      window.location.href = url.href;
      return;
    }

    const html = await response.text();
    const nextDocument = parser.parseFromString(html, "text/html");
    const nextMain = nextDocument.querySelector(mainSelector);
    const currentMain = document.querySelector(mainSelector);

    if (!nextMain || !currentMain) {
      window.location.href = url.href;
      return;
    }

    updateHead(nextDocument);
    currentMain.replaceWith(nextMain);
    runPageScripts(nextMain);
    updateNav(url);

    if (action === "push") {
      window.history.pushState({}, "", url.href);
    }

    scrollToTarget(url);
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || !shouldHandle(event, link)) return;

    event.preventDefault();
    navigate(new URL(link.href)).catch(() => {
      window.location.href = link.href;
    });
  });

  window.addEventListener("popstate", () => {
    navigate(new URL(window.location.href), "replace").catch(() => {
      window.location.reload();
    });
  });
})();
