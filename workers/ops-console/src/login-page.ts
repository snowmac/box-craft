// T13: the ops console's login page. Deliberately minimal — plain HTML,
// inline styles (this one page is small enough not to need its own
// stylesheet), no client-side JS at all.
export function renderLoginPage(options: { error?: boolean } = {}): string {
	const errorMessage = options.error
		? '<p style="color:#b42318;margin:0 0 12px;">Incorrect token.</p>'
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BoxCraft Ops</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f6f7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    form { background: #fff; border: 1px solid #e3e3e3; border-radius: 16px; padding: 32px; width: 280px; }
    h1 { font-size: 1.125rem; margin: 0 0 16px; }
    input { width: 100%; padding: 8px; border: 1px solid #e3e3e3; border-radius: 6px; box-sizing: border-box; margin-bottom: 12px; font-size: 0.875rem; }
    button { width: 100%; padding: 8px; border: none; border-radius: 6px; background: #202223; color: #fff; cursor: pointer; font-size: 0.875rem; }
  </style>
</head>
<body>
  <form method="POST" action="/login">
    <h1>BoxCraft Ops</h1>
    ${errorMessage}
    <input type="password" name="token" placeholder="Ops token" required autofocus>
    <button type="submit">Log in</button>
  </form>
</body>
</html>`;
}
