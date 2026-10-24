import RundotGameAPI from '@series-inc/rundot-game-sdk/api'

// The game must stay playable in a plain browser (local dev, itch-style hosting),
// so every SDK call is wrapped and falls back to localStorage / no-op when the
// platform runtime is absent.
const hasSdk = (() => {
  try {
    return !!RundotGameAPI && !!RundotGameAPI.appStorage
  } catch {
    return false
  }
})()

const LS_KEY = 'rundot-survivor-save'

export async function loadBest(): Promise<number> {
  if (hasSdk) {
    try {
      const v = await RundotGameAPI.appStorage.getItem('bestScore')
      if (v != null) return Number(v) || 0
    } catch { /* fall through to localStorage */ }
  }
  return Number(localStorage.getItem(LS_KEY)) || 0
}

export async function saveBest(score: number, best: number): Promise<void> {
  if (score <= best) return
  if (hasSdk) {
    try {
      await RundotGameAPI.appStorage.setItem('bestScore', String(score))
      return
    } catch { /* fall through */ }
  }
  localStorage.setItem(LS_KEY, String(score))
}

/** Returns true if the ad was watched to completion. */
export async function showRewardedAd(): Promise<boolean> {
  if (!hasSdk) return false
  try {
    await RundotGameAPI.ads.showRewardedAdAsync()
    return true
  } catch {
    return false
  }
}
