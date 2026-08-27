# CBAM Regulatory Source Register

## Purpose

This document defines the regulatory and reference-data sources used by the Snowkap CBAM calculation engine.

## Source hierarchy

### Binding legislation

1. Regulation (EU) 2023/956
2. Regulation (EU) 2025/2083
3. Commission Implementing Regulation (EU) 2025/2547
4. Commission Implementing Regulation (EU) 2025/2620
5. Commission Implementing Regulation (EU) 2025/2621
6. Commission Implementing Regulation (EU) 2026/1740
7. Commission Implementing Regulation (EU) 2025/2546

### Official Commission datasets

Official reference datasets published by the European Commission.

### Commission guidance

Official Commission guidance used for interpretation and implementation guidance.

Guidance is not legally binding.

### Snowkap assumptions

Product assumptions introduced by Snowkap where the legislation does not prescribe the assumption.

### User-provided data

Data supplied by customers or operators.

## Rules

1. Production regulatory values must not be hardcoded into application logic.
2. Every regulatory value must have provenance.
3. Regulatory datasets must be versioned.
4. Effective dates must be stored.
5. A historical calculation must remain reproducible after a dataset update.
6. A calculation must record the regulatory dataset version used.
