# Security policy

Report vulnerabilities privately to the repository owner. Do not include live credentials, customer addresses, tokens, or provider payloads in an issue.

Supported deployments use Node.js 20.19 or newer and PostgreSQL 17. Run full and production-only dependency audits on every release. Rotate JWT and webhook secrets immediately after suspected disclosure, increment affected identity token versions, revoke provider credentials, and retain audit/database evidence for incident analysis.

The console keeps bearer tokens only in component memory. Production authentication should issue short-lived tokens through the organization identity provider; the development seed is not an identity provider and refuses production use.
