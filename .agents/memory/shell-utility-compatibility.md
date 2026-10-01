---
name: Shell utility compatibility
description: Reduced Unix utility support can make workspace searches misleading.
---

Do not assume every workspace command is the full GNU utility. Check error output before interpreting empty search results, especially from pipelines.

**Why:** This environment returned reduced-utility usage errors for standard flags such as `grep -E`, `grep -x`, `ps -p`, and `find -maxdepth`. A later pipeline stage could still exit successfully, making a failed search look like there were no matches.

**How to apply:** Prefer the available ripgrep for content searches and Node filesystem APIs for directory enumeration or process metadata when standard flags are unsupported. Do not treat unsupported-option output as evidence that a file, package, process, or matching text is absent.