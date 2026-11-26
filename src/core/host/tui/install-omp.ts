/** Installs oh-my-pi's kit on import, so it is active before any other module evaluates. */
import { installTuiKit } from "./index.ts";
import { ompTuiKit } from "./omp.ts";

installTuiKit(ompTuiKit);
