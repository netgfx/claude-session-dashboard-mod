declare module 'claude-code' {
  interface PluginState {
    'session-dashboard': {
      // Everything the pane shows, kept so a hot reload doesn't zero the counts
      snapshot: Record<string, unknown>
    }
  }
}
