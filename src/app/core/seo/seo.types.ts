export interface SeoConfig {
  title?: string;
  description?: string;
  robots?: string;
  canonicalUrl?: string;
  og?: {
    type?: string;
    image?: string;
    siteName?: string;
    locale?: string;
  };
  twitter?: {
    card?: string;
    site?: string;
  };
  jsonLd?: object | object[];
}
