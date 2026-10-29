# DocBook frontend

React + Vite frontend for browsing doctors and booking appointments. It requests data from the Express API at `/api`.

The private administrator panel is available at `/admin`; configure its account using `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the backend environment.

## Commands

```bash
npm run dev
npm run build
npm run lint
```

Run the backend and MongoDB as described in the project README. During development, Vite forwards `/api` requests to `http://localhost:5000`.
