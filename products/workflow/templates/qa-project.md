<!--
  Template: .aidt/qa.md · written once by the qa agent when missing, then kept by the team.
  Rules for the agent:
  - Fill only what the repository shows (scripts, end-to-end setup, docs); mark the rest «to fill».
  - Concrete commands, ports and paths, never «as usual».
  Delete these comments when filling the template.
-->
# QA in this project

What the `qa` agent needs to know here. Keep it current when the way to run the product, its
people or its fakes change.

## The people

| Person | Device | Their journeys |
|---|---|---|
| … | phone / desktop | … |
| Someone with bad intentions | any | another person's links, ids and sessions; odd inputs; replays |

## What each journey should do

<!-- Where the flow documents, the UX and security rules, the decisions taken and the promises
     (landing page, terms, emails, help texts) live. -->

Already known or accepted, not to report again unless worse: …

## Running the product

<!-- Numbered steps: services, a database of the QA's own, migrations, the servers with their
     ports and environment, where each log goes, and how to stop what was started. -->

1. …

## Email, files and fakes

<!-- Local mail catcher and its API, file storage, and every service faked locally with the file
     that fakes it, so a product bug can be told from a fake's limit. -->

## Browsers and clients

<!-- Device presets, how each person gets a client of their own (rate limits per IP), where the
     screens' labels and quick ways to a state are (end-to-end helpers). -->

## Simulating time

<!-- What data the QA may change to make a link or session expire or a job come due, and where. -->

## Designs and processes

<!-- Where the designs (clickable prototypes) and the written business processes live. -->
