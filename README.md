# GenePilot

**Your companion for exploring biological sequences through bioinformatics and AI.**

GenePilot is a bioinformatics platform designed to make biological sequence analysis more accessible through a unified interface. By combining bioinformatics tools with AI-assisted interpretation, GenePilot aims to help users move from raw biological data toward more understandable, actionable scientific insights.

Rather than requiring users to navigate multiple independent tools and interpret disconnected outputs, GenePilot brings biological analysis into a single workflow, with a foundation that can be extended as new analytical capabilities are introduced.

> **Project status:** Under active development. Some capabilities depend on external services and deployment configuration. See [Architecture](#architecture) and [Current capabilities](#current-capabilities) for details.

---

## Table of Contents

- [Why GenePilot?](#why-genepilot)
- [Project Vision](#project-vision)
- [Current Capabilities](#current-capabilities)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)

## Why GenePilot?

Biological sequence analysis often involves multiple tools, specialized formats, and domain-specific knowledge. While individual bioinformatics tools can perform powerful analyses, moving between them and interpreting their outputs can introduce unnecessary complexity.

GenePilot explores a more integrated approach.

The project aims to connect three essential stages of biological data exploration:

1. **Input:** Provide biological sequences and analytical requests through a unified interface.
2. **Analysis:** Execute biological computations through dedicated bioinformatics services.
3. **Interpretation:** Use an optional AI layer to help explain analytical results in a more accessible and contextual form.

The goal is not to replace established bioinformatics software or scientific expertise. Instead, GenePilot aims to make analytical workflows easier to access, understand, and extend.

## Project Vision

GenePilot is built around the idea that biological data exploration should not require users to manually orchestrate every analytical component.

The long-term vision is to develop a modular platform in which users can express a biological question, have the system route it to an appropriate analytical capability, and receive results accompanied by useful explanations.

For example, a user might ask:

- How many adenine nucleotides are present in this DNA sequence?
- What are the basic characteristics of this sequence?
- What can the output of a particular biological analysis tell me?

These examples illustrate the intended interaction model. The availability of each analytical operation depends on the services implemented and enabled in a particular deployment.

GenePilot is being developed with three guiding principles:

- **Accessibility:** Reduce unnecessary friction between a biological question and the tools needed to investigate it.
- **Modularity:** Keep analytical services independent so that individual capabilities can be developed, tested, and maintained separately.
- **Interpretability:** Explore how AI can help users understand computational results without confusing generated explanations with experimentally established facts.

## Current Capabilities

GenePilot's current architecture provides the foundation for the following capabilities.

| Component | Responsibility |
|---|---|
| Web interface | Provides the user-facing application for submitting requests and accessing the platform. |
| Backend API | Handles application requests and coordinates analysis workflows. |
| Analysis worker | Processes queued analysis jobs asynchronously. |
| Bio Service | Performs biological analysis independently of the AI interpretation layer. |
| PostgreSQL | Stores application data and relational records. |
| Redis | Supports job queuing and coordination between the backend and worker. |
| MinIO | Provides S3-compatible object storage for the local environment. |
| Langflow integration | Enables an optional AI interpretation layer when configured. |

The exact analytical operations available to users are determined by the implementation of the Bio Service and the enabled workflows.

### Bioinformatics without mandatory AI

GenePilot separates biological computation from AI-assisted interpretation.

The Bio Service can execute analysis without Langflow. This means the underlying analytical workflow does not inherently depend on an AI model to operate.

When Langflow is configured, the platform can additionally incorporate an AI interpretation layer. This separation helps keep computational results distinct from the natural-language explanations generated around them.

## How It Works

At a high level, GenePilot follows a service-oriented workflow.

```mermaid
flowchart TD
    U[User] --> F[Frontend]
    F --> B[Backend API]
    B --> D[(PostgreSQL)]
    B --> Q[(Redis Queue)]
    Q --> W[Analysis Worker]
    W --> S[Bio Service]
    S --> W
    W --> O[(MinIO Object Storage)]
    W --> L{Langflow Enabled?}
    L -->|Yes| A[AI Interpretation]
    L -->|No| R[Analysis Results]
    A --> R
    R --> B
    B --> F
    F --> U
```

The diagram illustrates the intended high-level separation of responsibilities. The exact persistence, result-delivery, and Langflow invocation sequence may vary with the current implementation.

### 1. Request submission

A user interacts with the GenePilot frontend and submits an analytical request. The frontend communicates with the backend API rather than directly orchestrating the underlying services.

### 2. Request coordination

The backend handles the application request and coordinates the analysis workflow. PostgreSQL provides relational data storage, while Redis supports asynchronous job processing.

### 3. Asynchronous execution

The analysis worker consumes queued jobs and communicates with the Bio Service. Running analysis outside the main API request path allows computational work to be handled independently of ordinary application requests.

### 4. Biological computation

The Bio Service performs the requested biological computation and produces analytical outputs. Its responsibility is to provide computational results, not to serve as the entire application or necessarily to generate natural-language explanations.

### 5. Optional AI interpretation

When Langflow is configured, the workflow can incorporate AI-assisted interpretation of analytical outputs.

This layer is intended to make results easier to understand. AI-generated explanations should still be evaluated against the underlying outputs and relevant scientific evidence.

### 6. Result delivery

The application coordinates the resulting information and makes it available through the frontend. PostgreSQL, Redis, and MinIO serve distinct roles rather than acting as interchangeable storage systems.

## Architecture

GenePilot uses a modular architecture in which application concerns, biological computation, asynchronous processing, and AI interpretation are separated.

### Frontend

**Location:** `front/`

The frontend provides the user-facing interface and communicates with the backend through its configured API URL.

Local development uses Next.js and exposes the application at `http://localhost:3000`.

See [`front/README.md`](front/README.md) for frontend-specific setup and deployment documentation.

### Backend API and Analysis Worker

**Location:** `back/`

The backend coordinates application requests and analysis workflows.

Two processes are used during local development:

- **API server:** Handles application requests.
- **Analysis worker:** Processes queued analytical jobs separately from the API server.

This separation prevents the API process from being responsible for all computational work directly.

Local development exposes the API at `http://localhost:4000`.

See [`back/README.md`](back/README.md) for backend configuration, database migrations, and deployment instructions.

### Bio Service

The Bio Service is responsible for biological computations requested by the application.

In the local environment, it is accessible at `http://localhost:8001`. The service runs independently of the optional Langflow integration.

Keeping biological computation in a dedicated service allows analytical capabilities to evolve without requiring every change to be implemented inside the main backend.

### Data and Infrastructure Services

GenePilot uses three supporting infrastructure components locally:

- **PostgreSQL:** Relational application data and schema management.
- **Redis:** Asynchronous job queuing and coordination.
- **MinIO:** S3-compatible object storage.

These services are started through `docker-compose.local.yml`.

The analysis worker is configured with a dedicated queue name to help isolate local jobs from other workers that might share the same Redis instance.

### AI Interpretation Layer

Langflow provides an optional integration point for AI-assisted interpretation.

When the relevant `LANGFLOW_*` environment variables are unset, local analysis runs through the Bio Service without the AI interpretation layer.

When configured with valid deployment values, the integration can enable the AI workflow. The exact configuration keys are documented in `back/.env.example`.

## Technology Stack

| Technology | Role |
|---|---|
| Next.js | Web application framework |
| Bun | JavaScript and TypeScript runtime, package manager, and development tooling |
| Docker Compose | Local infrastructure orchestration |
| PostgreSQL | Relational database |
| Redis | Job queue and coordination |
| MinIO | S3-compatible object storage |
| Bio Service | Dedicated biological computation service |
| Langflow | Optional AI workflow integration |

The Bio Service's implementation language and the underlying biological analysis libraries should be documented in its own service documentation.

## Getting Started

### Prerequisites

Install the following before starting local development:

- Git
- Bun 1.1 or newer
- Docker with Docker Compose support
- OpenSSL for generating an authentication secret

### 1. Clone the repository

```bash
git clone <repo> && cd hackaton-hackativ8
git checkout baca
```

The current development branch is `baca`.

### 2. Start local infrastructure

From the repository root, run:

```bash
docker compose -f docker-compose.local.yml up -d
```

This starts PostgreSQL, Redis, MinIO, the MinIO bucket initialization service, and the Bio Service.

Check the service status:

```bash
docker compose -f docker-compose.local.yml ps
```

Confirm that the required containers are running and healthy before proceeding.

To stop the local infrastructure:

```bash
docker compose -f docker-compose.local.yml down
```

To remove the containers and their associated Compose-managed volumes:

```bash
docker compose -f docker-compose.local.yml down -v
```

**Warning:** The `-v` option removes persistent local volumes and can delete development data.

### 3. Configure and start the backend

Open a terminal:

```bash
cd back
cp .env.example .env
```

Generate a fresh authentication secret:

```bash
openssl rand -base64 64
```

Replace `AUTH_SECRET` in `back/.env` with the generated value.

Install dependencies and initialize the database:

```bash
bun install
bun run db:migrate
```

Start the backend API:

```bash
bun run dev
```

The API should now be available at `http://localhost:4000`.

### 4. Start the analysis worker

Open a separate terminal from the repository root:

```bash
cd back
bun run worker:analysis
```

The worker must remain running while you execute analysis jobs locally.

Starting the API alone is not sufficient for queued analysis to complete.

### 5. Configure and start the frontend

Open another terminal:

```bash
cd front
cp .env.example .env.local
bun install
bun run dev
```

The frontend should now be available at `http://localhost:3000`.

Open the application in your browser and continue as a guest or register an account, depending on the current application configuration.

### 6. Enable optional AI interpretation

Langflow is not required for the basic local analysis workflow.

To enable AI interpretation, configure the relevant `LANGFLOW_*` variables in `back/.env` using the values for your deployed Langflow environment.

Refer to `back/.env.example` for the exact environment variable names and expected values.

Restart the backend after changing environment variables so that the updated configuration is loaded.

## Environment Configuration

### Backend: `back/.env`

Create this file from `back/.env.example`.

| Variable | Local value |
|---|---|
| `DATABASE_URL` | `postgresql://genepilot:genepilot@127.0.0.1:5432/gene_pilot` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `ANALYSIS_QUEUE_NAME` | `genomic-analysis-local` |
| `S3_ENDPOINT` | `http://127.0.0.1:9000` |
| `S3_BUCKET` | `genepilot` |
| `S3_ACCESS_KEY_ID` | `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | `minioadmin` |
| `BIO_SERVICE_URL` | `http://127.0.0.1:8001` |
| `CORS_ORIGINS` | `http://localhost:3000` |
| `RATE_LIMIT_FALLBACK_TO_UNKNOWN` | `1` |
| `AUTH_SECRET` | Generate with `openssl rand -base64 64` |

The MinIO credentials shown above are intended for the local development environment only. Replace them with appropriate credentials in deployed environments.

The local queue name is deliberately distinct so that a worker on another machine sharing the same Redis instance does not unintentionally consume local analysis jobs.

### Frontend: `front/.env.local`

Create this file from `front/.env.example`.

| Variable | Local value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` |

### Hostname consistency

Use `localhost` consistently when accessing the frontend and backend through the browser.

For example:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

Do not switch between `localhost` and `127.0.0.1` for browser-facing application URLs. Browsers treat them as different hosts, which can interfere with cookie-based authentication.

Note that internal service connections, such as the backend's database and object storage URLs, may still use `127.0.0.1` in the provided local configuration.

## Development Workflow

The repository is organized around independently runnable services.

When developing a new feature, consider the following workflow:

1. Identify whether the change belongs to the frontend, backend, Bio Service, or AI integration.
2. Implement the change in the service responsible for that behavior.
3. Update the relevant environment variables or service configuration if necessary.
4. Test the service independently where possible.
5. Test the complete workflow across the frontend, backend, worker, and required dependencies.
6. Update the relevant service README whenever its setup, behavior, or deployment requirements change.

Keep the root README focused on project-wide concepts and local development. Detailed deployment procedures and service-specific environment documentation belong in the individual service READMEs.

## Troubleshooting

### Sign-in appears to do nothing

Make sure the frontend and backend use consistent browser-facing hostnames. Avoid mixing `localhost` and `127.0.0.1`.

### Storage is unavailable

The MinIO initialization service may not have created the bucket successfully.

Restart the local infrastructure:

```bash
docker compose -f docker-compose.local.yml up -d
```

Alternatively, open the MinIO console at `http://localhost:9001` and create the `genepilot` bucket manually.

The default local console credentials are `minioadmin` / `minioadmin`.

### Queued analysis never completes

Check that the analysis worker is running:

```bash
cd back
bun run worker:analysis
```

If multiple workers share Redis, verify that `ANALYSIS_QUEUE_NAME` uses the intended queue name:

```text
genomic-analysis-local
```

Also verify that the Bio Service is available at the configured `BIO_SERVICE_URL`.

### Database connection fails

Check that PostgreSQL is running and that `DATABASE_URL` matches the credentials, database name, and port configured in the local Compose environment.

If the schema has not been initialized, run:

```bash
cd back
bun run db:migrate
```

### AI interpretation is unavailable

The basic analysis workflow does not require Langflow. If AI interpretation is expected, verify the `LANGFLOW_*` variables in `back/.env`, confirm that the configured Langflow deployment is accessible, and restart the backend.

## Project Structure

```text
.
├── back/
│   ├── README.md
│   └── .env.example
├── front/
│   ├── README.md
│   └── .env.example
├── langflow/
│   └── README.md
├── docker-compose.local.yml
└── README.md
```

This is a high-level representation of the documented project layout, not an exhaustive inventory of every source file.

- `back/` contains backend application code and analysis worker functionality.
- `front/` contains the web application.
- `langflow/` contains Langflow-related project documentation and configuration.
- `docker-compose.local.yml` defines the local infrastructure environment.
- The root `README.md` explains the project and how to run its local development environment.

For service-specific deployment instructions, consult the corresponding README.

## Roadmap

GenePilot's architecture provides a foundation for further development in several areas:

- **Expanded analytical capabilities:** Add more biological analysis operations through dedicated services.
- **Smarter request routing:** Route user requests to the appropriate analytical service based on their intent.
- **AI-assisted interpretation:** Improve the presentation and explanation of computational results while preserving the distinction between analysis and generated interpretation.
- **Workflow extensibility:** Make it easier to introduce new analytical services without tightly coupling them to the frontend or backend.
- **Scientific reliability:** Improve validation, error handling, traceability, and the presentation of evidence supporting analytical results.

These items describe development directions rather than a guarantee that the corresponding features are already implemented.

---

**GenePilot** is an evolving effort to bring bioinformatics workflows and AI-assisted understanding closer together, while keeping the underlying analytical services modular and independently maintainable.
