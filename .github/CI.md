# Framework CI

Push, pull request, and manual **Framework checks** runs all use the standard
GitHub-hosted `ubuntu-24.04` runner. Each job gets a disposable VM with its own
MariaDB and Redis services. To run checks manually, open **Actions → Framework
checks → Run workflow**.

GitHub provides standard hosted runners free and unlimited for public
repositories; these runs do not use the monthly minutes allowance for private
repositories. Larger runners and storage have separate billing rules. See
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Keep the complete interface, coverage, packed consumer, and release policy
checks. App tests run with four workers, and concurrency cancellation stops
superseded runs for the same pull request or branch.

Do not register the shared private-project worker with this public repository.
Workflow conditions and runner labels do not isolate a machine from malicious
pull request changes. See
[GitHub's self-hosted runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners).
