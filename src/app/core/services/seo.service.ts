import { Injectable, Inject, Renderer2, RendererFactory2 } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { SeoConfig } from '../seo/seo.types';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private renderer: Renderer2;

  constructor(
    private meta: Meta,
    private title: Title,
    @Inject(DOCUMENT) private doc: Document,
    rf: RendererFactory2
  ) {
    this.renderer = rf.createRenderer(null, null);
  }

  apply(cfg: SeoConfig) {
    if (cfg.title) this.title.setTitle(cfg.title);
    if (cfg.description)
      this.meta.updateTag({ name: 'description', content: cfg.description });
    this.meta.updateTag({
      name: 'robots',
      content: cfg.robots ?? 'index,follow',
    });

    if (cfg.title)
      this.meta.updateTag({ property: 'og:title', content: cfg.title });
    if (cfg.description)
      this.meta.updateTag({
        property: 'og:description',
        content: cfg.description,
      });
    this.meta.updateTag({
      property: 'og:type',
      content: cfg.og?.type ?? 'website',
    });
    if (cfg.og?.image)
      this.meta.updateTag({ property: 'og:image', content: cfg.og.image });
    if (cfg.og?.siteName)
      this.meta.updateTag({
        property: 'og:site_name',
        content: cfg.og.siteName,
      });
    if (cfg.og?.locale)
      this.meta.updateTag({ property: 'og:locale', content: cfg.og.locale });

    this.meta.updateTag({
      name: 'twitter:card',
      content: cfg.twitter?.card ?? 'summary_large_image',
    });
    if (cfg.twitter?.site)
      this.meta.updateTag({ name: 'twitter:site', content: cfg.twitter.site });

    this.setCanonical(cfg.canonicalUrl ?? this.currentUrl());

    this.setJsonLd(cfg.jsonLd);
  }

  private currentUrl(): string {
    const url = this.doc.location?.href ?? '';
    return url.split('#')[0];
  }

  private setCanonical(url: string) {
    let link: HTMLLinkElement | null = this.doc.querySelector(
      "link[rel='canonical']"
    );
    if (!link) {
      link = this.renderer.createElement('link');
      this.renderer.setAttribute(link, 'rel', 'canonical');
      this.renderer.appendChild(this.doc.head, link);
    }
    this.renderer.setAttribute(link, 'href', url);
  }

  private setJsonLd(data?: object | object[]) {
    const existing = this.doc.getElementById('ld-json');
    if (existing) existing.remove();
    if (!data) return;

    const script = this.renderer.createElement('script');
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'id', 'ld-json');
    script.text = JSON.stringify(data);
    this.renderer.appendChild(this.doc.head, script);
  }
}
