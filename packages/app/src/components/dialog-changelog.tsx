import { createSignal, onMount, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { getRelativeTime } from "@/utils/time"
import { ReleaseList } from "@/components/release-list"
import "./dialog-changelog.css"

const REPO = "anomalyco/opencode"
const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases`

type Release = {
  tag: string
  body: string
  date: string
}

function transformGitHubReferences(body: string): string {
  let result = body

  result = result.replace(/#(\d+)/g, (_, id) => {
    return `[#${id}](https://github.com/anomalyco/opencode/issues/${id})`
  })

  result = result.replace(/@([a-zA-Z0-9_-]+)/g, (_, username) => {
    return `[@${username}](https://github.com/${username})`
  })

  return result
}

function parseReleases(json: unknown): Release[] {
  const releases: Release[] = []

  if (!Array.isArray(json)) {
    return releases
  }

  for (const release of json) {
    if (!release || typeof release !== "object") continue
    const body = typeof release.body === "string" ? transformGitHubReferences(release.body) : ""
    releases.push({
      tag: typeof release.tag_name === "string" ? release.tag_name : "Unknown",
      body,
      date: typeof release.published_at === "string" ? getRelativeTime(release.published_at) : "",
    })
  }

  return releases
}

export function DialogChangelog() {
  const dialog = useDialog()
  const platform = usePlatform()
  const [releases, setReleases] = createSignal<Release[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [page, setPage] = createSignal(1)
  const [hasMore, setHasMore] = createSignal(true)
  const PER_PAGE = 10

  async function loadReleases(reset = false) {
    const currentPage = reset ? 1 : page()
    const isLoading = reset ? setLoading : setLoadingMore

    try {
      isLoading(true)
      const fetcher = platform.fetch ?? fetch
      const response = await fetcher(`${GITHUB_API_URL}?per_page=${PER_PAGE}&page=${currentPage}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      })
      if (!response.ok) throw new Error("Failed to load")

      const json = await response.json()
      const parsed = parseReleases(json)

      if (parsed.length < PER_PAGE) {
        setHasMore(false)
      }

      if (reset) {
        setReleases(parsed)
      } else {
        setReleases((prev) => [...prev, ...parsed])
      }
    } catch {
      setError("Failed to load changelog")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  onMount(() => loadReleases())

  function handleClose() {
    dialog.close()
  }

  function handleLoadMore() {
    setPage((p) => p + 1)
    loadReleases()
  }

  return (
    <Dialog title="Changelog" class="dialog-changelog">
      <Show when={loading()}>
        <p class="text-text-weak p-6">Loading...</p>
      </Show>
      <Show when={error()}>
        <p class="text-text-weak p-6">{error()}</p>
      </Show>
      <Show when={!loading() && !error() && releases().length === 0}>
        <p class="text-text-weak p-6">No releases found.</p>
      </Show>
      <Show when={!loading() && !error() && releases().length > 0}>
        <ReleaseList
          releases={releases()}
          hasMore={hasMore()}
          loadingMore={loadingMore()}
          onLoadMore={handleLoadMore}
        />
      </Show>
    </Dialog>
  )
}
