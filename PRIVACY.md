# Privacy statement: Session Dashboard

Applies to the Session Dashboard mod for Claude Code (`powermods-session-dashboard`), published at https://github.com/netgfx/claude-session-dashboard-mod.

## What it collects

The mod shows facts about the Claude Code session you are in, on your own machine:

- Your current request's text, tool-call summaries, error messages, token counts, the prompt cache's state, the task list and the subagents, as Claude Code reports them to the mod.
- The background commands Claude starts in this session, with the process ids and listening ports of the processes under this Claude Code process. It never keeps processes started by anything else on the machine.
- The folders you link into the workspace from its Linked folders section: each link's name, the target folder's path and when you added it.

It collects no personal data, no account details and no credentials.

## Where it is stored

- The session figures are held in memory by Claude Code for the session (`$.state`). They are gone when the session ends.
- The linked-folder list is kept in the plugin's local store, a JSON file under `~/.claude/plugins/store/` whose name starts with `powermods-session-dashboard_`. Every Claude Code session on the same machine can read it.
- Links you create live at the workspace root, with an entry in the project's `.gitignore`.

## What leaves your machine

Nothing. The mod makes no network requests, calls no model, and declares no hosts. It sends no data to the author or to anyone else.

## Retention and deletion

- Session figures: until the session ends, or `/session-dashboard reset`.
- Linked-folder list: until you remove a link with its ✕ button. To remove everything, remove the links and delete the store file named above.

## Sharing

No data is sold or shared with anyone.

## Children

The mod is a developer tool and is not directed at anyone under 18.

## Contact

Questions or concerns: https://github.com/netgfx/claude-session-dashboard-mod/issues
