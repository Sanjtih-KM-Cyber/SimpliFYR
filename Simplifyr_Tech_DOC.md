SIMPLIFYR
Technical Product & Implementation Document
Simplify the signal. Preserve the truth.
Product: Simplifyr
Underlying framework: Universal Log Pre-processing Framework (ULPF)
Document purpose: Define the UI, UX, system architecture, user flow, AI implementation, technology stack, data flow, security model, and development roadmap for building Simplifyr using free and open-source technologies.
________________________________________
1. Product Vision
Simplifyr is an intelligent, vendor-agnostic log and event preprocessing platform built around the principles of:
•	Understand
•	Normalize
•	Preserve
•	Adapt
•	Trace
•	Simplify
The goal is to allow organizations to ingest logs/events from heterogeneous perimeter network devices and transform them into a consistent, human-readable, analytics-ready representation.
Simplifyr should hide the complexity of:
•	vendor-specific formats
•	different software versions
•	inconsistent field names
•	proprietary schemas
•	Syslog/JSON/XML/CSV/CEF/LEEF formats
•	changing event structures
from the end user.
The product should behave like a wall clock:
Configure it, start it, and let it operate continuously. Human interaction should primarily occur when a new source, schema change, ambiguity, or exceptional condition requires a decision.
________________________________________
2. Simplifyr vs ULPF
These terms must remain distinct.
ULPF — Universal Log Pre-processing Framework
ULPF is the technical framework/concept required by the problem statement.
It describes the underlying capability to:
•	ingest logs
•	parse heterogeneous formats
•	normalize fields
•	preserve raw events
•	maintain traceability
•	onboard new sources
•	produce standardized representations
•	support analytics/SIEM/ML systems
Simplifyr
Simplifyr is the product built around that framework.
Simplifyr provides:
•	the user interface
•	source onboarding
•	mapping configuration
•	output profiles
•	AI-assisted interpretation
•	schema drift detection
•	human-in-the-loop approval
•	knowledge management
•	monitoring
•	event exploration
•	deployment and administration
In simple terms:
ULPF is the engine/framework. Simplifyr is the product experience built on top of it.
________________________________________
3. Core Product Philosophy
Simplifyr follows five principles.
3.1 Lossless
The original event must never be discarded merely because it has been parsed or normalized.
3.2 Vendor Agnostic
The architecture must not depend on a particular firewall, router, operating system, SIEM, or security vendor.
3.3 User Defined
Simplifyr may provide presets, but users should be able to define:
•	what information they want
•	how they want it represented
•	which fields matter
•	which output format they require
3.4 AI Assisted, Not AI Dependent
AI should assist with ambiguity, interpretation, onboarding, and change detection.
High-volume deterministic processing should not depend on an LLM.
3.5 Human in the Loop
AI recommendations that modify production knowledge should be reviewable and versioned.
________________________________________
4. High-Level Architecture
                    NETWORK / SECURITY SOURCES
                             │
             ┌───────────────┼────────────────┐
             │               │                │
          Firewall         Router           Other
             │               │                │
             └───────────────┼────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    INGESTION    │
                    │                 │
                    │ Syslog          │
                    │ HTTP            │
                    │ File            │
                    │ Kafka           │
                    │ Other adapters  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  EVENT QUEUE    │
                    │     Kafka       │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ PROCESSING      │
                    │ ENGINE          │
                    │                 │
                    │ Detect          │
                    │ Parse           │
                    │ Classify        │
                    │ Map             │
                    │ Validate        │
                    └────────┬────────┘
                             │
                 ┌───────────┴───────────┐
                 │                       │
               Known                  Unknown/
               Event                   Changed
                 │                       │
                 ▼                       ▼
             Process                  AI Engine
                                         │
                                         ▼
                                  Human Review
                                         │
                                         ▼
                                  Knowledge Base
                                         │
                 └───────────┬───────────┘
                             ▼
                    ┌─────────────────┐
                    │ NORMALIZED      │
                    │ EVENT           │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ OUTPUT ENGINE   │
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
              SIEM       Data Lake        ML
________________________________________
5. Major System Components
Simplifyr consists of the following logical components:
1.	Frontend
2.	API layer
3.	Ingestion layer
4.	Event processing engine
5.	Parser system
6.	Normalization engine
7.	Output engine
8.	AI intelligence layer
9.	Knowledge registry
10.	Human approval system
11.	Storage layer
12.	Monitoring and observability
13.	Authentication and authorization
________________________________________
6. Technology Stack
All technologies should be free to use and preferably open source.
Layer	Technology
Frontend	React + TypeScript
Frontend build	Vite
UI	Tailwind CSS + shadcn/ui
Backend	Python + FastAPI
Processing	Python
Async processing	Python workers
Message broker	Apache Kafka
Database	PostgreSQL
Vector search	pgvector
Cache	Redis
Raw event storage	MinIO
AI runtime	llama.cpp / Ollama
AI models	Small quantized open-source instruct model
Containers	Docker
Development orchestration	Docker Compose
Enterprise orchestration	Kubernetes
Monitoring	Prometheus
Dashboards	Grafana
Logging	OpenTelemetry-compatible tooling
API documentation	OpenAPI / Swagger
Version control	Git + GitHub
CI/CD	GitHub Actions
Authentication	Keycloak or compatible OIDC provider
No paid API or cloud AI dependency is required for the core system.
________________________________________
7. Hardware-Aware AI Architecture
Development hardware:
•	16 GB RAM
•	NVIDIA RTX 3050
•	4 GB VRAM
•	1.5 TB storage
The system should therefore avoid large language models.
The initial AI architecture should target:
Small, quantized, locally executable models.
Potential model families can be benchmarked rather than selected purely by reputation.
Candidates may include small variants of:
•	Qwen
•	Gemma
•	Phi
•	Llama
The final model should be selected based on performance against Simplifyr-specific tasks.
________________________________________
8. AI Philosophy
Simplifyr does not initially need to train its own LLM.
Instead:
Small Base Model
        +
Structured Context
        +
Vendor Knowledge
        +
Existing Mappings
        +
Previous Events
        +
Rules
        +
Human Feedback
        ↓
Simplifyr Intelligence
The AI's job is primarily to interpret and recommend.
The deterministic engine remains responsible for normal event processing.
________________________________________
9. AI Responsibilities
The AI layer can perform:
Source identification
Determine likely:
•	vendor
•	product
•	technology
•	format
Event classification
Determine whether an event represents:
•	network traffic
•	authentication
•	connection
•	policy action
•	VPN event
•	configuration change
•	threat/security event
•	etc.
Field semantic mapping
Example:
srcip
   ↓
source.ip
Schema drift detection
Example:
OLD:
action

NEW:
decision
Version detection
Determine whether a structural change may represent a software version change.
Mapping recommendation
Suggest new mappings for previously unknown fields.
________________________________________
10. AI Must Produce Structured Output
The model should never be trusted to return arbitrary text to the processing engine.
AI responses should follow a strict schema.
Example:
{
  "classification": "schema_drift",
  "confidence": 0.96,
  "likely_vendor": "Vendor X",
  "likely_product": "Firewall",
  "likely_version": "7.x",
  "field_changes": [
    {
      "old_field": "action",
      "new_field": "decision",
      "semantic_field": "network.action"
    }
  ],
  "requires_human_approval": true
}
The backend validates this response before doing anything with it.
________________________________________
11. AI Is Not in the Main Event Path
This is a critical architecture decision.
Normal event:
Event
 ↓
Parser
 ↓
Known Mapping
 ↓
Normalize
 ↓
Output
Unknown event:
Event
 ↓
Parser
 ↓
Unknown / Changed
 ↓
AI
 ↓
Recommendation
 ↓
Human approval if required
 ↓
Knowledge update
This ensures that billions of events do not require LLM inference.
________________________________________
12. Knowledge Registry
The Knowledge Registry is one of the most important parts of Simplifyr.
It stores what Simplifyr has learned/configured.
Conceptually:
Vendor
 └── Product
      └── Version
           └── Format
                └── Event Type
                     └── Field Mappings
Example:
Vendor X
 └── Firewall
      ├── v5
      │    └── Mapping A
      ├── v6
      │    └── Mapping B
      └── v7
           └── Mapping C
Old mappings are not destroyed when new versions appear.
________________________________________
13. Adaptation Model
Simplifyr adapts at three levels.
Level 1 — User configuration
User explicitly defines:
foo → source.ip
The mapping is stored.
Level 2 — AI-assisted knowledge
AI identifies a potential mapping.
Human approves it.
The approved mapping becomes part of the knowledge registry.
Level 3 — Future model improvement
Once sufficient approved data exists, the project may eventually fine-tune a small model for domain-specific event interpretation.
This is a future capability, not a first-release requirement.
________________________________________
14. User Experience
Simplifyr should not feel like a chatbot.
It should feel like an enterprise operations console.
The UI should prioritize:
•	clarity
•	status
•	event visibility
•	configuration
•	exceptions
•	explainability
•	trust
The AI should appear primarily when it has something useful to say.
________________________________________
15. Main Navigation
The primary navigation should contain:
Dashboard
Sources
Events
Outputs
Drift
Knowledge
Settings
________________________________________
16. Dashboard
Purpose:
Quickly determine whether Simplifyr is functioning correctly.
Example:
Events Processed
12.4M

Events / Second
4,821

Active Sources
42

Unknown Events
37

Schema Changes
3
Health:
Ingestion       ● Healthy
Processing      ● Healthy
Storage         ● Healthy
AI Engine       ● Healthy
Outputs         ● Healthy
The dashboard should emphasize exceptions rather than unnecessary analytics.
________________________________________
17. Sources Page
Shows all configured sources.
Example:
Firewall-01
Vendor X Firewall
v6
Syslog
● Active

Firewall-02
Vendor Y Firewall
v4
CEF
● Active

Router-01
Vendor Z Router
v12
JSON
● Active
Each source can expose:
•	connection status
•	event rate
•	vendor
•	product
•	version
•	format
•	mappings
•	output profiles
•	recent errors
________________________________________
18. Source Onboarding
User selects:
+ Add Source
Options:
Live Connection
Upload Sample
Paste Event
Connect Existing Stream
This is important:
Onboarding is not the same thing as ingestion.
Onboarding teaches/configures Simplifyr.
Ingestion continuously receives production events.
________________________________________
19. Automatic Detection
After receiving sample data:
Analyzing...

✓ Format detected: Syslog
✓ Structured data detected
✓ Likely device: Firewall
✓ Vendor candidate: Vendor X
✓ Event type: Network Traffic

Confidence: 96%
The user can inspect the reasoning before continuing.
________________________________________
20. Mapping Interface
Example:
Source Field	Simplifyr Field	Confidence
srcip	source.ip	99%
dstip	destination.ip	99%
sport	source.port	98%
dport	destination.port	98%
proto	network.protocol	98%
action	network.action	97%
Mappings are editable.
User corrections become configuration/knowledge.
________________________________________
21. Output Profiles
Users choose what they want to receive.
Presets may include:
•	SOC Investigation
•	Network Monitoring
•	SIEM
•	Threat Hunting
•	Analytics
•	Machine Learning
But these are only presets.
Users can create:
Custom Output Profile
and select their own fields.
________________________________________
22. Output Example
A normalized representation could look like:
{
  "timestamp": "2026-09-15T10:31:44Z",
  "source": {
    "ip": "10.0.0.5",
    "port": 43122
  },
  "destination": {
    "ip": "8.8.8.8",
    "port": 443
  },
  "network": {
    "protocol": "TCP",
    "action": "DENY"
  }
}
The exact schema should remain configurable.
________________________________________
23. Event Explorer
Users should be able to inspect an event through four views:
[ RAW ]
[ PARSED ]
[ NORMALIZED ]
[ OUTPUT ]
This makes the transformation understandable.
________________________________________
24. Raw Event
Example:
<134>Sep 15 10:31:44 firewall01 ...
This representation must remain untouched.
________________________________________
25. Parsed Event
Example:
{
  "srcip": "10.0.0.5",
  "dstip": "8.8.8.8",
  "proto": "TCP",
  "action": "deny"
}
________________________________________
26. Normalized Event
Example:
{
  "source": {
    "ip": "10.0.0.5"
  },
  "destination": {
    "ip": "8.8.8.8"
  },
  "network": {
    "protocol": "TCP",
    "action": "DENY"
  }
}
________________________________________
27. Provenance
Every normalized event should be traceable back to its source.
Conceptually:
Raw Event
   ↓
Parser Version
   ↓
Source Definition
   ↓
Mapping Version
   ↓
Normalization Version
   ↓
Output Profile
   ↓
Final Output
This is necessary for:
•	forensic investigation
•	compliance
•	debugging
•	trust
•	auditability
________________________________________
28. Drift Detection UX
Suppose a known firewall changes:
OLD:

srcip
dstip
action
New event:
source_address
destination_address
decision
Simplifyr should not simply report:
Parser Error
Instead:
⚠ POSSIBLE SCHEMA CHANGE

Firewall-01

Previous:
srcip
dstip
action

Current:
source_address
destination_address
decision

Likely cause:
Software/schema update

Confidence:
96%
________________________________________
29. Human-in-the-Loop
The system should ask:
Is this a new vendor?

[ YES ] [ NO ]
and:
Is this a software/schema update?

[ YES ] [ NO ]
The answers determine the next workflow.
________________________________________
30. New Vendor Workflow
If the answer is yes:
New Vendor
     ↓
Collect Sample
     ↓
AI Analysis
     ↓
Generate Mapping
     ↓
User Review
     ↓
Approve
     ↓
Create Vendor Definition
     ↓
Activate
________________________________________
31. New Version Workflow
If the vendor is known:
Known Vendor
     ↓
Known Product
     ↓
New Structure
     ↓
AI compares with previous version
     ↓
Suggest Version
     ↓
User approval
     ↓
Create version-specific mapping
Existing mappings remain intact.
________________________________________
32. Knowledge Versioning
Never blindly overwrite production mappings.
Instead:
Vendor X Firewall

v5
Mapping v2

v6
Mapping v4

v7
Mapping v1
Every change should be auditable.
________________________________________
33. Storage Architecture
PostgreSQL
Stores structured metadata:
•	users
•	sources
•	vendors
•	products
•	versions
•	mappings
•	output profiles
•	onboarding records
•	approvals
•	drift records
•	audit records
MinIO
Stores:
•	raw events
•	large samples
•	archived event data
•	replay datasets
Kafka
Moves high-volume events through the processing system.
Redis
Provides temporary:
•	cache
•	state
•	rate limiting
•	short-lived processing data
________________________________________
34. Event Lifecycle
The canonical event flow:
INGEST
   ↓
RAW EVENT STORED
   ↓
FORMAT DETECTION
   ↓
PARSING
   ↓
SOURCE RESOLUTION
   ↓
EVENT CLASSIFICATION
   ↓
FIELD MAPPING
   ↓
VALIDATION
   ↓
NORMALIZATION
   ↓
OUTPUT TRANSFORMATION
   ↓
DELIVERY
At all times, the original event remains available.
________________________________________
35. Parser Architecture
Parsers should be modular.
Parser Interface

├── Syslog Parser
├── JSON Parser
├── XML Parser
├── CSV Parser
├── CEF Parser
├── LEEF Parser
└── Proprietary Parser
Vendor-specific semantics should not be hard-coded into the parser itself.
The parser answers:
"How do I structurally read this?"
The knowledge registry answers:
"What does this field mean?"
________________________________________
36. Separation of Concerns
This distinction is fundamental.
Parser
srcip=10.0.0.5
becomes:
{
  "srcip": "10.0.0.5"
}
Semantic mapper
determines:
srcip → source.ip
Output engine
determines:
Which fields does the user want?
How should they be represented?
This prevents the system from becoming a collection of vendor-specific scripts.
________________________________________
37. Security Architecture
Because Simplifyr processes security data, security must be built into the architecture.
Important controls:
•	authentication
•	authorization
•	audit logs
•	encrypted transport
•	secure secrets management
•	input validation
•	payload size limits
•	rate limiting
•	isolation of AI processing
•	versioned configuration
•	approval workflows
________________________________________
38. AI Security
Log content must be treated strictly as untrusted data.
A malicious event could contain text such as:
Ignore previous instructions...
The AI must never interpret event content as system instructions.
The architecture should clearly separate:
SYSTEM INSTRUCTIONS
        +
STRUCTURED KNOWLEDGE
        +
UNTRUSTED EVENT DATA
The model should only produce a constrained structured response.
________________________________________
39. Confidence and Automation
Confidence should influence what Simplifyr does.
Example policy:
> 98%
Potential automatic handling

90–98%
Human review

< 90%
Quarantine / investigation
These are initial examples, not fixed product requirements.
The thresholds should eventually be configurable.
More importantly:
AI confidence alone must not authorize dangerous production changes.
________________________________________
40. Deployment
Simplifyr should be containerized.
Development:
Docker Compose
Possible services:
frontend
backend
worker
ai
postgres
redis
kafka
minio
Future enterprise deployment:
Kubernetes
This supports the requirement for platform-independent packaging.
________________________________________
41. Air-Gapped Deployment
Core functionality must not depend on the internet.
A complete deployment should be capable of operating inside:
┌─────────────────────────────────────────────┐
│              AIR-GAPPED NETWORK             │
│                                             │
│ Simplifyr                                    │
│                                             │
│ Frontend                                     │
│ Backend                                      │
│ Processing                                   │
│ Kafka                                        │
│ PostgreSQL                                   │
│ MinIO                                        │
│ Redis                                        │
│ Local AI Model                               │
│                                             │
└─────────────────────────────────────────────┘
External internet access should not be a requirement for normal operation.
________________________________________
42. Development Environment
Development can initially be performed entirely on the local machine.
Recommended setup:
VS Code
Git
Python
Node.js
Docker
Docker Compose
PostgreSQL
Redis
Kafka
MinIO
Local LLM runtime
No paid development platform is required.
________________________________________
43. GitHub
The codebase should be organized as a proper engineering project.
Suggested repository:
simplifyr/

├── frontend/
├── backend/
├── ai/
├── parsers/
├── schemas/
├── deployment/
├── docs/
├── tests/
├── sample-data/
└── README.md
________________________________________
44. Testing Strategy
Testing must exist at multiple levels.
Unit Tests
Test:
•	parsers
•	mappings
•	validators
•	normalization
•	output generation
Integration Tests
Test:
Ingestion
 ↓
Processing
 ↓
Storage
 ↓
Output
AI Evaluation
Maintain a benchmark dataset containing known examples.
Test:
•	vendor identification
•	field mapping
•	event classification
•	schema drift
•	version detection
Regression Testing
Every approved mapping should be testable against historical events.
________________________________________
45. Golden Dataset
We should build a local test corpus.
Example:
sample-data/

├── firewall/
│   ├── vendor-a/
│   ├── vendor-b/
│   └── vendor-c/
│
├── router/
├── vpn/
├── ids/
└── other/
Each dataset should contain:
•	raw events
•	expected parsed representation
•	expected semantic mapping
•	expected output
This becomes our regression suite.
________________________________________
46. AI Benchmark
Before choosing the final model, test several small models against the same dataset.
Metrics:
Mapping accuracy
Did the model map the field correctly?
Classification accuracy
Did it identify the event correctly?
Drift detection accuracy
Did it correctly identify structural changes?
False positive rate
How often did it report a change that wasn't actually meaningful?
Latency
How quickly can it respond?
Resource consumption
How much RAM/VRAM does it use?
The winner should be the model that performs best for Simplifyr, not necessarily the most popular model.
________________________________________
47. Development Roadmap
Phase 1 — Foundation
Build:
•	repository
•	frontend shell
•	FastAPI backend
•	PostgreSQL
•	basic event model
•	Docker environment
________________________________________
Phase 2 — Parsing
Implement:
•	Syslog
•	JSON
•	CEF
•	LEEF
Add sample datasets.
________________________________________
Phase 3 — Normalization
Implement:
•	semantic event model
•	field mapping
•	mapping versioning
•	validation
•	provenance
________________________________________
Phase 4 — UI
Build:
•	Dashboard
•	Sources
•	Onboarding
•	Mapping Editor
•	Output Profiles
•	Event Explorer
________________________________________
Phase 5 — Local AI
Add:
•	local model runtime
•	vendor identification
•	field mapping recommendations
•	event classification
________________________________________
Phase 6 — Adaptive Intelligence
Add:
•	schema drift detection
•	version detection
•	mapping suggestions
•	human approval
•	knowledge updates
________________________________________
Phase 7 — Real-Time Ingestion
Add:
•	Syslog listener
•	Kafka
•	worker architecture
•	continuous processing
________________________________________
Phase 8 — Enterprise Hardening
Add:
•	authentication
•	authorization
•	audit logs
•	observability
•	high availability
•	Kubernetes deployment
•	air-gapped installation package
________________________________________
48. What the First Complete Version Should Demonstrate
The first meaningful version should demonstrate the complete vertical workflow:
Firewall Event
      ↓
Ingest
      ↓
Detect Format
      ↓
Parse
      ↓
Identify Source
      ↓
Map Fields
      ↓
Normalize
      ↓
Preserve Raw Event
      ↓
Generate User-Selected Output
      ↓
Display Result
Then demonstrate the differentiating capability:
New Event Structure
      ↓
Detect Drift
      ↓
AI Analysis
      ↓
Ask Human
      ↓
Approve New Mapping
      ↓
Version Knowledge
      ↓
Continue Processing
That second workflow is particularly important because it demonstrates that Simplifyr is not merely a collection of static parsers.
________________________________________
49. What We Are NOT Building
To keep the architecture disciplined, Simplifyr is initially not:
•	a SIEM
•	a firewall
•	a complete SOC platform
•	a threat intelligence platform
•	an LLM chatbot
•	a replacement for a data lake
•	a proprietary AI model
•	a vendor-specific parser collection
Simplifyr sits before those systems.
Its job is to make heterogeneous event data understandable and consistent before downstream systems consume it.
________________________________________
50. Final Product Architecture
The final conceptual architecture is:
                         SIMPLIFYR
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
       ▼                    ▼                    ▼
   INGESTION             INTELLIGENCE         STORAGE
       │                    │                    │
       │               ┌────┴────┐               │
       │               │         │               │
       │              AI       Knowledge         │
       │               │         │               │
       │               └────┬────┘               │
       │                    │                    │
       └──────────────┬─────┴────────────────────┘
                      ▼
               PROCESSING ENGINE
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
        Parse      Normalize    Validate
          │           │           │
          └───────────┼───────────┘
                      ▼
                OUTPUT ENGINE
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
            SIEM    Data Lake   ML
________________________________________
51. The Core Principle
The most important architectural principle for Simplifyr is:
AI handles uncertainty. Code handles scale. Knowledge preserves learning. Humans control important changes.
This gives us four complementary systems:
CODE
↓
Fast deterministic processing

AI
↓
Interpretation and reasoning

KNOWLEDGE
↓
Persistent organizational understanding

HUMAN
↓
Trust and governance
Together, these create the adaptive behavior we want.
________________________________________
52. Final Vision
A user should eventually be able to connect a new network environment to Simplifyr and say:
"Here are my events. This is what I want the output to look like."
Simplifyr should then:
Understand the source
        ↓
Learn the mapping
        ↓
Get human approval
        ↓
Process continuously
        ↓
Preserve everything
        ↓
Detect changes
        ↓
Explain changes
        ↓
Ask for help only when necessary
        ↓
Adapt safely
        ↓
Continue working
The user should not have to continuously maintain parsers.
The user should not need to understand every vendor's schema.
The user should not have to manually transform every new event format.
And the AI should never silently change production behavior without appropriate controls.
The desired end state is simple:
The user configures Simplifyr. Simplifyr handles the complexity.
Simplifyr — Simplify the signal. Preserve the truth.

