/** Installs Pi's kit on import, so it is active before any other module evaluates. */
import { installTuiKit } from "./index.ts";
import { piTuiKit } from "./pi.ts";

installTuiKit(piTuiKit);
