# Polaris Action

## Overview

The Polaris Github Action runs polaris scan, retrieves the scan results and generates SARIF report.

## Prerequisites

* To use this Action you **must be a licensed Polaris customer.**

| :exclamation: To get a demo and learn more about Polaris [click here](https://www.synopsys.com/software-integrity/polaris/demo-github.html).|
|-----------------------------------------|

## Example YAML config

```yaml
name: "Polaris Scan Action"

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  security:
    name: security scans
    runs-on: ubuntu-latest

    steps:
    - name: Checkout repository
      uses: actions/checkout@v2

    # If this run was triggered by a pull request event, then checkout
    # the head of the pull request instead of the merge commit.
    - run: git checkout HEAD^2
      if: ${{ github.event_name == 'pull_request' }}

    - name: Static Analysis with Polaris Action
      uses: devsecops-test/polaris-action@v1
      with:
        polarisServerUrl: ${{secrets.POLARIS_SERVER_URL}}
        polarisAccessToken: ${{secrets.POLARIS_ACCESS_TOKEN}}
        polarisProjectName: insecure-bank
    
    - name: Incremental Static Analysis with Polaris Action for Pull Request
      uses: devsecops-test/polaris-action@v1
      with:
        polarisServerUrl: ${{secrets.POLARIS_SERVER_URL}}
        polarisAccessToken: ${{secrets.POLARIS_ACCESS_TOKEN}}
        polarisProjectName: insecure-bank
        polarisAdditionalArgs: --coverity-ignore-capture-failure --incremental polaris-files-to-scan.txt | tee polaris-output.txt
        githubUrl: https://api.github.com/repos/$GITHUB_REPOSITORY/pulls/$(jq --raw-output .pull_request.number "$GITHUB_EVENT_PATH")/files
        githubCreds: "${{secrets.GITHUB_USERNAME}}:${{secrets.GITHUB_TOKEN}}"     #Needed only if repository is private

    - name: Incremental Static Analysis with Polaris Action for a single commit
      uses: devsecops-test/polaris-action@v1
      with:
        polarisServerUrl: ${{secrets.POLARIS_SERVER_URL}}
        polarisAccessToken: ${{secrets.POLARIS_ACCESS_TOKEN}}
        polarisProjectName: insecure-bank
        polarisAdditionalArgs: --coverity-ignore-capture-failure --incremental polaris-files-to-scan.txt | tee polaris-output.txt
        githubUrl: https://api.github.com/repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA
        githubCreds: "${{secrets.GITHUB_USERNAME}}:${{secrets.GITHUB_TOKEN}}"     #Needed only if repository is private

    - name: Upload SARIF file
      uses: github/codeql-action/upload-sarif@v1
      with:
        # Path to SARIF file relative to the root of the repository
        sarif_file: polaris-scan-results.sarif.json
```
