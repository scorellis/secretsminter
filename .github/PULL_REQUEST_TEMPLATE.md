<!-- Thank you for contributing to a security tool. See CONTRIBUTING.md and AI_REVIEW.md. -->

## What this changes

<!-- One or two sentences. What and why. -->

## Security checklist

- [ ] No secret value can cross the tool boundary, an error string, or a log line (value-blindness preserved).
- [ ] Any place/rotate path still goes through the destination allow-list (`assertAllowed`, default-deny).
- [ ] No feature is claimed as working before it is built (not-yet-wired paths throw `NotWiredError`; stories updated).
- [ ] The kill switch and approval remain out-of-band (not exposed as MCP tools).
- [ ] `npm run build` and `npm test` pass; security-core changes include a test (adversarial where applicable).

## Notes for reviewers

<!-- Anything you want a human or AI reviewer to look at especially closely. -->
