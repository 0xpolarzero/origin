import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Account } from "@/account"

export const LoginCommand = cmd({
  command: "login [url]",
  describe: "log in to an opencode account",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Log in")

    const url = args.url as string | undefined
    const login = await Account.login(url)

    prompts.log.info("Go to: " + login.url)
    prompts.log.info("Enter code: " + login.user)

    try {
      const open =
        process.platform === "darwin"
          ? ["open", login.url]
          : process.platform === "win32"
            ? ["cmd", "/c", "start", login.url]
            : ["xdg-open", login.url]
      Bun.spawn(open, { stdout: "ignore", stderr: "ignore" })
    } catch {}

    const spinner = prompts.spinner()
    spinner.start("Waiting for authorization...")

    let wait = login.interval * 1000
    while (true) {
      await Bun.sleep(wait)

      const result = await Account.poll(login)

      if (result.type === "success") {
        spinner.stop("Logged in as " + result.email)
        prompts.outro("Done")
        return
      }

      if (result.type === "pending") continue

      if (result.type === "slow") {
        wait += 5000
        continue
      }

      if (result.type === "expired") {
        spinner.stop("Device code expired", 1)
        return
      }

      if (result.type === "denied") {
        spinner.stop("Authorization denied", 1)
        return
      }

      spinner.stop("Error: " + result.msg, 1)
      return
    }
  },
})

export const LogoutCommand = cmd({
  command: "logout",
  describe: "log out from an account",
  async handler() {},
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: "switch active workspace",
  async handler() {},
})

export const WorkspacesCommand = cmd({
  command: "workspaces",
  aliases: ["workspace"],
  describe: "list all workspaces",
  async handler() {},
})
