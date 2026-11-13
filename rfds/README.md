# RFDs — Request for Discussion

This directory contains **Request for Discussion** documents for major technical decisions, architectural changes, and design proposals.

## What is an RFD?

An RFD is a document that:
- Proposes a technical solution or architectural decision
- Explains the problem it solves
- Discusses alternatives considered
- Documents the final decision and rationale

## When to Create an RFD?

Create an RFD for:
- Major architectural decisions
- Breaking changes to APIs or schemas
- New technology adoption
- Performance optimizations that change architecture
- Security-related changes
- Anything that affects multiple packages or requires coordination

## RFD Template

```markdown
# RFD-XXX: [Title]

## Status
[Draft | In Review | Approved | Implemented | Rejected]

## Problem
[What problem are we solving?]

## Proposed Solution
[What is the proposed solution?]

## Alternatives Considered
[What other options were considered?]

## Decision
[What was decided?]

## Implementation Notes
[How will this be implemented?]

## References
[Links to related discussions, issues, etc.]
```

## Current RFDs

| RFD | Title | Status | Depends on |
|---|---|---|---|
| [RFD-001](RFD-001-electrobun-2-upgrade.md) | Upgrade Electrobun 1.12.3 → 2.0.6 | Draft | — |
| [RFD-002](RFD-002-single-pass-pipeline-and-clip.md) | Single-pass analysis pipeline + CLIP similarity | Draft | — |
| [RFD-003](RFD-003-google-takeout-sidecars-and-albums.md) | Google Takeout: JSON sidecars, albums, motion photos | Draft | — |
| [RFD-004](RFD-004-react-ui-rewrite.md) | React UI rewrite on Electrobun 2.x, no `useEffect` | Draft | RFD-001 |
| [RFD-005](RFD-005-folder-owner-devices.md) | Folder owner devices: keep the copy in the phone owner's folder | Draft | RFD-003, RFD-004 |

Suggested order: RFD-001 → RFD-002 (pipeline refactor first) and RFD-003 in parallel →
RFD-004. The production dedup run waits for all four, on a fresh Google Takeout.

## Process

1. **Draft**: Agent creates RFD with proposal
2. **Review**: Other agents and maintainers review
3. **Decision**: Approved, rejected, or needs revision
4. **Implementation**: If approved, implement and update status
5. **Archive**: Keep RFDs for historical reference
