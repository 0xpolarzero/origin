import { createSignal, onMount, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Markdown } from "@opencode-ai/ui/markdown"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import "./dialog-changelog.css"

const REPO = "anomalyco/opencode"
const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases`

type Release = {
  tag: string
  body: string
  date: string
}

function parseReleases(json: unknown): Release[] {
  const releases: Release[] = []

  if (!Array.isArray(json)) {
    return releases
  }

  for (const release of json) {
    if (!release || typeof release !== "object") continue
    releases.push({
      tag: typeof release.tag_name === "string" ? release.tag_name : "Unknown",
      body: typeof release.body === "string" ? release.body : "",
      date: typeof release.published_at === "string" ? new Date(release.published_at).toLocaleDateString() : "",
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
    <Dialog size="x-large" class="dialog-changelog">
      <div class="flex flex-col h-full">
  
        <div class="dialog-changelog-content flex-1 overflow-y-auto p-6">
          <Show when={loading()}>
            <p class="text-text-weak">Loading...</p>
          </Show>
          <Show when={error()}>
            <p class="text-text-weak">{error()}</p>
          </Show>
          <Show when={!loading() && !error() && releases().length === 0}>
            <p class="text-text-weak">No releases found.</p>
          </Show>
          <Show when={!loading() && !error() && releases().length > 0}>
            <div class="space-y-6">
              <For each={releases()}>
                {(release) => (
                  <div class="dialog-changelog-release">
                    <div class="flex items-baseline gap-2">
                      <span class="dialog-changelog-version">{release.tag}</span>
                      <Show when={release.date}>
                        <span class="text-12-regular text-text-weak">{release.date}</span>
                      </Show>
                    </div>
                    <Markdown
                      text={release.body}
                      class="dialog-changelog-markdown prose prose-sm max-w-none text-text-base"
                    />
                  </div>
                )}
              </For>
            </div>
            <Show when={hasMore()}>
              <div class="mt-6 flex justify-center">
                <Button variant="secondary" size="small" onClick={handleLoadMore} loading={loadingMore()}>
                  Load more
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
