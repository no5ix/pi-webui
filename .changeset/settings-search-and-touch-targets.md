---
"@gang-of-beads/pi-web": patch
---
Settings grows a **search box above its page list**. Typing narrows the pages to the ones whose name,
or the settings behind them, match: "plugin" leaves **Pi Web Plugins**, "token" leaves **Machines**,
"theme" leaves **Appearance**, "restart" leaves **Pi Web Plugins**. A query that matches nothing says
so inside the page list — *No settings match "…".* — instead of leaving the dialog looking empty, and
clearing the query, closing Settings, or switching machines brings all eight pages back. The search
finds pages; it never hides a setting that is on the page you are reading, and it does not filter what
the server sent.

On a touch device the settings page list, the search box and the controls inside a pane are now **44px
tall**, the floor this project uses everywhere else a finger is the pointer; on a mouse the sizes stay
as they were.
