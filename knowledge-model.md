# InfoMagnus knowledge model

## Concept types

| Type | Meaning |
| --- | --- |
| Organization | An organization named by a source page. |
| Service | A service InfoMagnus describes on its site. |
| Solution | A named product or solution described by InfoMagnus. |
| Industry | An industry explicitly named by a source page. |
| Technology | A technology explicitly named by a source page. |
| Capability | A capability explicitly described by a source page. |
| CaseStudy | A named customer outcome or case study. |
| Insight | An article, event, or other published insight. |
| Outcome | A result explicitly reported by a source page. |

## Relationships

Each relationship needs an excerpt from a captured source page. Internal navigation alone does not establish a relationship unless the link appears in the page's main content.

| Relationship | Direction | Evidence |
| --- | --- | --- |
| supports | Service or Solution to Capability | Source statement connecting the offering to the capability. |
| uses | Service or Solution to Technology | Source statement naming the technology in the offering. |
| serves | Service or Solution to Industry | Source statement naming the industry. |
| demonstrated_by | Service to CaseStudy | Source statement connecting the service and case study. |
| demonstrates | CaseStudy to Service or Outcome | Source statement naming the demonstrated service or outcome. |
| discusses | Insight to Technology or Service | Source statement that the insight discusses the concept. |
| references | Any concept to another concept | The source page names the target concept in its main text and links to its source page. |

## Evidence

Every description, claim, and relationship stores its source URL and an exact quote from the captured page text. The crawler preserves page text and its SHA-256 content hash in `site-inventory.json`. An accepted concept may not have an unsupported description or relationship.
