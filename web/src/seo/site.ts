import type { Metadata, MetadataRoute } from "next";

const PUBLIC_SITE_ORIGIN_ENV = "AUTH_URL";
const LOCAL_SITE_ORIGIN = "http://localhost:3000";

export const SITE_NAME = "tuttoseriea.com";
export const SITE_DESCRIPTION =
  "Русскоязычная платформа о Серии A и итальянском футболе.";

type RuntimeEnv = Record<string, string | undefined>;

function canUseLocalSiteOriginFallback(env: RuntimeEnv): boolean {
  return (
    env.CI === "true" ||
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "test"
  );
}

function parsePublicSiteOrigin(value: string): URL {
  const parsed = new URL(value);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${PUBLIC_SITE_ORIGIN_ENV} must be an absolute HTTP/HTTPS URL`);
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${PUBLIC_SITE_ORIGIN_ENV} must be a public origin URL`);
  }

  if (parsed.pathname !== "/") {
    throw new Error(`${PUBLIC_SITE_ORIGIN_ENV} must not include a path`);
  }

  return new URL(parsed.origin);
}

export function getPublicSiteOrigin(env: RuntimeEnv = process.env): URL {
  const configuredOrigin = env[PUBLIC_SITE_ORIGIN_ENV]?.trim();

  if (configuredOrigin) {
    return parsePublicSiteOrigin(configuredOrigin);
  }

  if (canUseLocalSiteOriginFallback(env)) {
    return new URL(LOCAL_SITE_ORIGIN);
  }

  throw new Error(
    `${PUBLIC_SITE_ORIGIN_ENV} is required for production site metadata`,
  );
}

export function createSiteUrl(pathname: `/${string}`, env: RuntimeEnv = process.env): string {
  return new URL(pathname, getPublicSiteOrigin(env)).toString();
}

export function buildRootMetadata(env: RuntimeEnv = process.env): Metadata {
  return {
    metadataBase: getPublicSiteOrigin(env),
    applicationName: SITE_NAME,
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    openGraph: {
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      siteName: SITE_NAME,
      locale: "ru_RU",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export const homeMetadata: Metadata = {
  alternates: {
    canonical: "/",
  },
};

export const adminNoindexMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export function buildRobots(env: RuntimeEnv = process.env): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/"],
    },
    sitemap: createSiteUrl("/sitemap.xml", env),
  };
}

export function buildSitemap(env: RuntimeEnv = process.env): MetadataRoute.Sitemap {
  return [
    {
      url: createSiteUrl("/", env),
    },
  ];
}
