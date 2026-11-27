// The 3D and flat views use the same versioned screen URLs as the HTML. The single-file copy embeds its media.
const screens = JSON.parse(document.getElementById('screen-urls')?.textContent ?? '{}');
export function assetUrl(path) {
  return window.GROCGO_INLINE_ASSETS?.[path] ?? screens[path] ?? path;
}
