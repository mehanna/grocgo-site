// Where the page finds a picture or video. The website serves them as files beside the page; the single-file copy
// (bundle-single-file.mjs) carries them inside the page as data URLs, listed in window.GROCGO_INLINE_ASSETS.
export function assetUrl(path) {
  return window.GROCGO_INLINE_ASSETS?.[path] ?? path;
}
