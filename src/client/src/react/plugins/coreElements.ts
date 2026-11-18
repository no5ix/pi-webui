/**
 * The React shell hosts the framework-owned Custom Elements PI WEB already
 * owns: the prompt editor, the quick switcher, the settings and auth dialogs,
 * the rename dialogs, and the extension dialog card.
 *
 * Each of those components registers itself when its module is loaded, and no
 * module in the React tree would load them on its own, so the shell would draw
 * empty boxes where a real control belongs. This module names the hosted set in
 * one place, and `bootstrap.ts` loads it before the shell renders. A plugin's
 * own elements are registered by the plugin loader, not here.
 */
import "../../components/AuthDialog";
import "../../components/ExtensionDialogCard";
import "../../components/ProjectRenameDialog";
import "../../components/PromptEditor";
import "../../components/QuickSwitcher";
import "../../components/SessionRenameDialog";
import "../../components/SettingsDialog";
