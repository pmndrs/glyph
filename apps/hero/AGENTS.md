# Hero code policies

- Prefer tests of observable features and common user stories. Add edge cases only for important behavior or meaningful regressions. Keep internal tests only where a difficult case cannot be covered reliably through observable behavior.
- Treat comments as documentation. Keep them concise and explain the algorithm or feature. Avoid change history, semicolons, and em dashes.
- Prefer inline values for local tuning. Before adding a top-level constant, check whether it needs a separate name or lifetime. Keep shared contracts and retained resources named when inlining would duplicate a coupled value or allocate during playback.
- Use Koota `query(...).updateEach` for query mutations.
- Put a blank line before and after hooks with callback bodies, loops, branches, and other code blocks when adjacent statements exist. Keep comments attached to their blocks, keep related `else` and `catch` clauses together, and separate returns from preceding work. Do not pad the inside of enclosing braces.
