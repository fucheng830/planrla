# Changelog

All notable changes to Planrla will be documented in this file.


## [0.3.0](https://github.com/fucheng830/planrla/compare/v0.2.0...v0.3.0) (2026-07-03)

### New Features

* **defaults:** configurable default model per provider ([7b7fd0c](https://github.com/fucheng830/planrla/commit/7b7fd0c0fd167fb2309731c9ed772f847c0133a0))
* **defaults:** new session uses global default permission mode ([9b96b12](https://github.com/fucheng830/planrla/commit/9b96b12fa9d7cecb3082db1e1d21e08f326f256c))
* **defaults:** one-time ack before default unrestricted permissions ([3882f14](https://github.com/fucheng830/planrla/commit/3882f1402c8a63edc1bf3be8a356d621c731c443))
* **defaults:** permission default fns + extend permissionmode with yolo ([6a9f886](https://github.com/fucheng830/planrla/commit/6a9f8862ff73694fe172bc454b6839fa1c58866c))
* **defaults:** settings ui for default permission/model + yolo badge ([57c3943](https://github.com/fucheng830/planrla/commit/57c3943940e313fc746af3168665c020f7091c03))
* **desktop:** mount title bar at app root ([87c447e](https://github.com/fucheng830/planrla/commit/87c447e87904592cae9b00c6781473b014dfe4c2))
* **desktop:** self-drawn title bar container ([a2747df](https://github.com/fucheng830/planrla/commit/a2747df52d74f9a4d6ce1cf0192690aa374c5082))
* **desktop:** theme cache + title bar overlay chrome ([336777d](https://github.com/fucheng830/planrla/commit/336777dda96df7fb30a679db23ad868e4565aac8))
* **i18n:** detect system language on first launch ([89a4275](https://github.com/fucheng830/planrla/commit/89a4275561f0c0618f02f29590a413094559918a))
* **i18n:** register fr + match region-less language codes ([0e3cc62](https://github.com/fucheng830/planrla/commit/0e3cc625574ad88646e8d0080ea2f20d9b0edaa7))
* **landing:** astro project skeleton (independent package.json) ([a98c109](https://github.com/fucheng830/planrla/commit/a98c109281644239335ea5fb6cc2350723d2e7f7))
* **landing:** changelog section (build-time fetch github releases) ([3908cc3](https://github.com/fucheng830/planrla/commit/3908cc36326f441ace953562ebe8e2dfbde08327))
* **landing:** download section linking github releases ([d084089](https://github.com/fucheng830/planrla/commit/d0840892ff13950efcd48604b7a7901aba09f480))
* **landing:** features section (4 cards, responsive grid) ([a1d9eaa](https://github.com/fucheng830/planrla/commit/a1d9eaabd95c9c3e78086c06260a11da6a0e256f))
* **landing:** finalize index title + assemble all sections ([a300c0a](https://github.com/fucheng830/planrla/commit/a300c0abcccbfe0555d27ea67847b458df9c324c))
* **landing:** gen-feed script + static fallback for release feed ([3b8fc20](https://github.com/fucheng830/planrla/commit/3b8fc2005b1453ec8195081a61ca16a62f3fbc3c))
* **landing:** hero section with CTAs + provider chips ([b4d446e](https://github.com/fucheng830/planrla/commit/b4d446ed8840486a1675d4f4c744d81357843a66))
* **landing:** nav + footer chrome components ([7721fd9](https://github.com/fucheng830/planrla/commit/7721fd990e3d47c1db5d1bdc493aac9b1818609c))
* **landing:** release normalize pure fns + tests ([22e3fc4](https://github.com/fucheng830/planrla/commit/22e3fc461dd9052249b344eb04e516270b13a218))
* **process:** release lifecycle SOP + single-track versioning ([22c2622](https://github.com/fucheng830/planrla/commit/22c262205331fa72b11f3a0185c1825409e0df82))
* **theme:** appearance tab uses theme mode selector + i18n ([91c0b4b](https://github.com/fucheng830/planrla/commit/91c0b4ba7c3f07bd5425520615799ed8a737eb75))
* **theme:** theme mode pure fns (system/light/dark) ([9c79c89](https://github.com/fucheng830/planrla/commit/9c79c89cbb892a4a7752d724227ede9a03ad394f))
* **theme:** theme mode selector segmented control ([2e1692e](https://github.com/fucheng830/planrla/commit/2e1692eaa11b72fdd5a0cef498c840cb7201a722))
* **theme:** three-state context (system/light/dark) ([0746fe0](https://github.com/fucheng830/planrla/commit/0746fe0075cefb2d1a60504f75cfa9859da95bb7))

### Bug Fixes

* **defaults:** catalog reconcile does not pollute provider-model when unset ([4e16fc9](https://github.com/fucheng830/planrla/commit/4e16fc93c3fe45fd7fddc12aa740498645767654))
* **gemini:** align permission modes with cli (default/yolo) ([09697cd](https://github.com/fucheng830/planrla/commit/09697cd7424bcd7e59745032a22146bbd57ff68d))
* **landing:** align STATIC_FALLBACK body with latest.json + correct gen-feed comment ([9236539](https://github.com/fucheng830/planrla/commit/9236539c96a7f1c63fbf076d2d2e59b8514564ac))
* **landing:** features icon symbol (local) + card-icon aria-hidden ([d25245c](https://github.com/fucheng830/planrla/commit/d25245cec53f8a7d51ead8be2a70130368f9a5b9))
* **req010:** skip restartRequired toast in packaged desktop ([8026075](https://github.com/fucheng830/planrla/commit/80260757b6c8da818d72a4f88a5a39364f813471))

### Performance

* **projects:** pure fn to group batched session rows by project ([e7ff15b](https://github.com/fucheng830/planrla/commit/e7ff15b10fa73b9f2aa30f04a1c413c2b7a74b01))
* **projects:** replace N+1 session query with batched SQL ([c052fc9](https://github.com/fucheng830/planrla/commit/c052fc9520685a89c3a1174fad3ecd793f2657b7))
* **projects:** skip inline sync on read path (sync only via ?sync=1) ([0ec919b](https://github.com/fucheng830/planrla/commit/0ec919be41ff60b28ae2d3bd4da3cd9346f8777f))
* **projects:** wire refresh to ?sync=1 + grouping edge-case test (review) ([ad3dc37](https://github.com/fucheng830/planrla/commit/ad3dc37d28488506467e3ea5eb9ab69891b4c436))
* **sessions:** batched first-page sessions SQL via window functions ([6ce5512](https://github.com/fucheng830/planrla/commit/6ce5512761089c9f7643b3a235c2a779832d2b27))

### Documentation

* file tree incremental implementation plan ([c268480](https://github.com/fucheng830/planrla/commit/c268480387c4e0e49f02cc055b9fa7fded018be4))
* file tree incremental loading design spec ([2abc2f5](https://github.com/fucheng830/planrla/commit/2abc2f5cab31924f0362886b1886386c4971244c))
* **landing:** landing page design spec + ignore .superpowers/ ([8c70b05](https://github.com/fucheng830/planrla/commit/8c70b05877f138d0f28908c34fade03ed474486e))
* **landing:** landing page implementation plan (11 tasks) ([6aefb47](https://github.com/fucheng830/planrla/commit/6aefb477b247b0d1dfc85ad5154b0b272403e530))
* **landing:** sync plan with STATIC_FALLBACK body + Features icon fix ([c8cd963](https://github.com/fucheng830/planrla/commit/c8cd96387a9826607b32d237cb8e442525357b5f))
* **plan:** sidebar open perf implementation plan (5 tasks, TDD) ([2a45bcf](https://github.com/fucheng830/planrla/commit/2a45bcfdf4a5fe789e5daf89b051d993d1928c0b))
* **plan:** tick + archive desktop-experience-defaults plan ([8fb746b](https://github.com/fucheng830/planrla/commit/8fb746bc5b2a2570660c93da2a9b7200e4c6c8a7)), closes [#1](https://github.com/fucheng830/planrla/issues/1)
* **req010:** spec for restartRequired toast fix ([004714f](https://github.com/fucheng830/planrla/commit/004714febda8ceb9c8ade6bf5ed2756e07a1b35a))
* **roadmap:** redirect P1 session-list item to projects-perf (verified) ([532e96f](https://github.com/fucheng830/planrla/commit/532e96f3e34f0585329eb6732d5cd583b18f2df7))
* **spec:** sidebar open perf — projects endpoint (inline sync + N+1) ([e46d0af](https://github.com/fucheng830/planrla/commit/e46d0afc3115e3f69da8eb1309c04f98541d499f))

### Maintenance

* **i18n:** drop orphaned appearance-settings dark-mode keys ([1644ead](https://github.com/fucheng830/planrla/commit/1644ead6baaf95c9789ce26651ea0fa775fef626))
* **landing:** add @astrojs/check + typescript as devdeps ([c72bdd2](https://github.com/fucheng830/planrla/commit/c72bdd2ad0b34acc2a77913d4a3de222c9cc3390))

### Tests

* **landing:** feed schema validation script ([2c08a3a](https://github.com/fucheng830/planrla/commit/2c08a3ad5309c3405fc25bd46335b3c723066108))

# Changelog

Release notes are distributed through the commercial update feed configured by NOMAD_UPDATE_CHECK_URL.
