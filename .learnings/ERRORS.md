# Errors

Command failures and integration errors.

---

## [ERR-20260525-001] browser-screenshot-api

**Logged**: 2026-05-25T22:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: frontend

### Summary
Used tab.playwright.screenshot in the in-app Browser runtime, but the supported screenshot API is tab.screenshot.

### Error
\n
### Suggested Action
Use tab.screenshot({ fullPage: false }) for Browser plugin screenshots.

### Metadata
- Source: error
- Related Files: none
- Tags: browser, screenshot, tooling

---
