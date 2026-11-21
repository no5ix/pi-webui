---
"pi-web": patch
---

**Pi Packages removal removes the package the page lists.** A path package
is recorded in the settings file in the shape the machine wrote it - for a
package inside the project's reach, the relative path - and removal was
delegated to pi's manager alone, which recognises only the source it
resolves itself. The browser pass caught the result: a reader installed a
package from a path, pressed Remove on the row, and the machine answered
that there was nothing to remove while the settings file went on naming the
package. PI WEB now asks the manager first - a manager removal also
unregisters what it loaded - and when it declines, drops the entry that
records that source, the same way the enabled switch writes the file. When
no entry names the package, the page says nothing was removed, which is the
truth about that file.
