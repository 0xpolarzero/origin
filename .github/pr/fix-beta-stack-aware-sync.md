title: fix: make beta sync conflict reporting stack-aware

### Issue for this PR

Closes #

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Makes beta sync failures stack-aware. On merge conflict, the script now reports conflicted files and likely conflicting beta PR(s), and upserts one marker-based bot comment instead of posting duplicates every run.

### How did you verify your code works?

- Ran `bun turbo typecheck --filter opencode`
- Ran `bunx prettier --check ".github/workflows/beta.yml" "script/beta.ts"`

### Screenshots / recordings

N/A

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
