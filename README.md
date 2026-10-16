| Variable                    | Default | Description                                                                      |
| --------------------------- | ------- | -------------------------------------------------------------------------------- |
| `EVENT_BASE_URL`            | —       | Base URL of the external event service (must be `http://event.com` for the mock) |
| `BREAKER_FAILURE_THRESHOLD` | `3`     | Failures within the window that open the circuit breaker                         |
| `BREAKER_WINDOW_MS`         | `30000` | Failure counting window                                                          |
| `BREAKER_COOLDOWN_MS`       | `5000`  | Initial wait before testing the service again                                    |
| `BREAKER_MAX_COOLDOWN_MS`   | `30000` | Maximum wait (cooldown doubles on each failed test)                              |

## Known issues

- No ReadMe File.
- no gitIgnore file.
- no swagger but that can be discussed.
- `GET /getUsers` and `GET /getEvents` have no error handling.
- No `resp.ok` check on GET routes; upstream error bodies are forwarded as success.
- `/getEventsByUserId`: unknown user id throws outside the `try` and returns an unhandled 500.
- Port is hardcoded to `3000`; no `PORT`.
- base URL was hardCoded is ok for a coding exercise but not in real live that why i added EVENT_BASE_URL
