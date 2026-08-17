# Isolated deployment model

The same commit builds each business profile. Each business has its own API Worker, console Worker, D1 database, Durable Object deployment identity, Access application/AUD, rate-limit namespaces, secrets, origins, and hostnames.

The API Worker is the Durable Object owner. The console has no Durable Object binding and reaches its business API through an explicit service binding. Public endpoints are independently disabled on console deployments. Moses public event intake and public chat are disabled until Sprint 3.

Moses files are templates until their placeholder D1 ID and Access AUD are replaced after resource approval. The isolation test validates names, bindings, profiles, service targets, and cross-business identifiers.
