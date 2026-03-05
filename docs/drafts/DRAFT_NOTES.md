Flows from personal app:
- calendar (events + tasks with the duration span, and horizon view)
- cron jobs (recurring tasks)
- signals (act on notification from external sources)
   - a signal is a custom view using notifications from specified sources, with possible filters, on which it can act when something new comes

These flows could be views => just pinned workspaces (like the global one); but we might want each workspace to be able to load from other workspaces (= folders) and not be contrained to only this folder as workspaces behave. So probably needs just a UI where the special origin workspace shows a special UI on top with these various views.

All of the above is stored in the Documents/origin/ repo, so each action to create/modify something above is committed.

All of the above shows in an activity tab (find more accurate name for agent actions) so we can use git to revert anything (which is a commit).

All of the above is created/modified/deleted from an entry, which is just a new chat, in which the agent has context on these and what it can do.
Entry should use an agent that has context/system prompt on all of these and how to access/use (will also know ).
When it wants to do so it uses a tool (is a tool the correct way to do so?) so it appears in the chat (so UX is good, we can see it did some special action).

Correct flow is probably:
- entry agent has context on these special actions, determines if one or multiple need to be invoked
- if so, it loads additional context on these
- e.g. it does something with a signal, or is prompted about email, it knows it has this special tool so it loads context on how to use emails

Specifics on the flows:
- calendar
  - pretty basic, it's some static stuff stored in the database
  - horizon view just needs to display nicely, and is a new view
- cron job
  - need a global tick or whatever is most efficient to keep background cron jobs
  - we probably want to make origin behave as some apps where it doesn't close on Quit but stays in the top menu unless you specifically click on it + quit
- signals
  - just subscribes to a query and shows its status
- cron jobs & signals
  - we need a good render as "workflow" with a chain of what happens, kind of trigger -> query/filter if any (friendly format + navigable to the actual editable query) -> action to do (we should prompt when creating such that it needs to provide a short label in addition to the actual prompting on what to do with it, and we want to render nicely, e.g. show special words when it acts on e.g. calendar or notes)
  - maybe we can have signals on other stuff, e.g. "when a file in x folder is modified" to interact outside the app but inside the machine, "when a new task in the calendar is added"
  - when adding an entry, and it understands we want to do anything signal-related (and probably for the rest) we might want have some questions for the user to quickly create it; but we might want an alternate flow when you create such stuff "manually" (can still be a chat with predefined questions, even better autocomplete, but in which the AI can kick in if it needs to, or maybe just take the finished flow for a review or for reformatting and adding directly)
- notes
  - TBD but simple markdown notes, rendering, useful to write stuff as context for agents, and for them to update, write random stuff that make sense, etc
  - makes me think that we might want to have a special (advanced) view that shows all system prompts, all the stuff power users might want to customize and make it easy; or are we better just telling them where the folder is?
- knowledge base
  - somewhere to easily drop files as context for agents, maybe something easily identified in a chat with @, any kind of file, and probably in system prompt we want to encourage agent to prioritize knowledge base rather than online (kind of like NotebookLM)

- integrations (probably the heaviest lift we need to really make good, also it's vulnerable to prompt injection)
  - first thing is an external sources/integrations menu in settings below providers and models, to connect with the most convenient flow to external data sources (e.g. gmail, telegram, github)
  - need to figure out what kind of fetching and reacting we can do for each source, and how to best display these queries
  - so we should actually have an integrations view as well, and it would show these queries, for which we need to figure out how to consistently render what is it, any filtering/querying in a good UX and understandable format (also as everything it should be editable directly by the user as well as the agents)
    - we probably have different kinds of queries which are just fetching or one that is reacting? If we need to? Or is the correct way here to just, in case of signal, just repeat some query; it depends on the providers but it shouldn't change much as just using query/subscription but same query inside
    - having queries in there we can use them in signals and cron jobs and just in a regular chat; it should show "used by", in signals and crons and even chat it should show "used x query/subscription", with quick links, quick view, etc
- activity
  - just shows everytime the AI used such a special action, with a short label, the diff (but might need some specific diff rendering for each kind of task), and possibility to revert
  - obviously needs special logic for e.g. reverting a cron job we need to really kill it, and refresh what needs refreshing

We can **later** easily add integrations, e.g. if you host your app in the cloud we can expose some endpoint so users can use the app from telegram or anywhere

Note on the non-personal app part of the app; basically what happens is that:
- in the special origin folder we have various tabs for what is described above, everything acts on the origin folder
- in any other folder (that is opened as a workspace) we have these other various tabs, that correspond for now to workflows you can do with your stuff; that would include for instance "work with a document", which would have predefined workflows like reviewing, translating, etc, obviously would be editable, and user could add any workflow, reorganize, etc
- these workspaces would have some similar views as the origin workspace but in their own context (we can drop that in a .origin/ folder we bootstrap in a workspace, which is probably the format we want to use in the origin workspace as well for consistency, just that it would have more of these special flows)
  - cron jobs (that will act only in this folder) also knowledge base, activity


For a workflow (whether in origin workspace or any other), we can just have it span a session with an agent, and keep going here, so it shows up in the chats.
So we might want special tags in the chats (as in triggered by an entry, triggered by just new chat, triggered by a cron job, triggered by a signal, etc) with filtering.

The queries should actually not be the only pieces of code with label we want to show in their view, and make available and editable to agents and user; what we want to encourage is storing also pieces of code, scripts. This way, in workflows and anywhere when agents consider something will be ran frequently, they can just write it into a script and reuse it, instead of writing it everytime. But the difference is probably (if that makes sense):
- we have a tab for these queries/scripts in both origin workspace and any workspace
- other workspaces don't show the special queries because it's only for integrations (? are we sure? is queries actually the right one? shouldnt we just consider all of these the same, and queries as pieces of code)
- we should have settings where users can enable/disable workflows that come with other-than-origin workspaces, and by default we provide workflows for reviewing, translating, this kind of stuff, that come with their system prompts, guidance, scripts

We need to figure out how to nail that scripts/queries/workflows thing. Show all scripts and "used in ..."? Make them available to all agents? Maybe too much bloat. Tie scripts/queries to a specific workflow each time? That should be ok anyway. Or maybe tell agent when creating/editing "see if there isn't already a script/query you can reuse". Difference between origin and other workspaces? Need to clarify all this and how it works, it's a very core design decision and will matter a lot in how well-crafted it feels using.