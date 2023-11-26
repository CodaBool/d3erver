import { Router } from 'itty-router'
const router = Router()

/*         Clients         */
// downloads ZIP after token validation

router.get('/', async (request, env) => {
	const url = new URL(request.url)
	const token = url.searchParams.get("token")
	const module = url.searchParams.get("module")
	const name = module?.slice(0, -7)

	if (!token || !module) {
		return new Response('missing token or module query', { status: 400 })
	}

	const tokenExists = await env.KV.get(token)

	if (!tokenExists) {
		return new Response('Expired token', { status: 403 })
	}

	const zip = await env.R2.get(module)

	if (zip === null) {
		return new Response(`module ${module} does not exist`, { status: 404 })
	}

	if (zip.status >= 400) {
		return new Response('Error fetching the zip file', { status: 500 })
	}

	await increment("foundry", name)

	// Return the zip file
	return new Response(zip.body, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}.zip"`,
		}
	})
})

/*         The Forge         */
// password based downloads by providing a secret in module.json "download" URL
// Forge removes the "download" URL prop, making this secure (TM)

router.get('/forge', async (request, env) => {
	const url = new URL(request.url)
	const module = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")
	const name = module?.slice(0, -7)

	if (!secret || !module) {
		return new Response('missing token or secret query', { status: 400 })
	}

	if (secret !== env.FORGE_SECRET) {
		return new Response("unauthorized", { status: 403 })
	}

	const zip = await env.R2.get(module)

	if (zip === null) {
		return new Response(`module ${module} does not exist`, { status: 404 })
	}

	if (zip.status >= 400) {
		return new Response('Error fetching the zip file', { status: 500 })
	}

	await increment("forge", name)

	return new Response(zip.body, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${name}.zip"`,
		}
	})
})

/*         Foundry Server         */
// creates a token in KV and returns JSON with a timed download URL

router.post('/', async (request, env)=> {
	const body = await request.json()
	const url = new URL(request.url)
	const allowedDomains = ["https://foundryvtt.com/", "https://api.foundryvtt.com/"]

	if (!allowedDomains.some(allowed => url === allowed)) {
		console.log("blocked", url, body, "if this was a mistake allow additional domains")
		if (body.api_key !== env.FOUNDRY_SECRET) {
			return new Response(`${url} is unauthorized`, { status: 403 })
		}
		console.log("aborting block, match on API secret. Add new Foundry domain of", url, "to allowlist!")
	}

	// 4h timed token
	const uuid = await crypto.randomUUID()
	await env.KV.put(uuid, body.user_id, { expirationTTL: 14400 })

	const data = JSON.stringify({
		package_name: body.package_name,
		version: body.version,
		download: `https://${env.DOMAIN}/?token=${uuid}&module=${body.package_name}-v${body.version}`,
	}, null, 2)

	return new Response(data, {
		headers: {
			'Content-Type': 'application/json',
		}
	})
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))

// increment CloudFlare D1, SQLite for record keeping
async function increment(platform, module) {
	try {
		let date = new Date()
		date = date.getFullYear() + "-" + (date.getMonth() + 1)
		
		const { meta } = await env.D1.prepare(`
			UPDATE downloads
			SET total = total + 1
			WHERE year_month = '${date}' and platform = '${platform}' AND module = '${module}';
		`).run()

		if (!meta.changes) {
			await env.D1.prepare(`
				INSERT OR IGNORE INTO downloads (platform, module, total, year_month) 
				VALUES ('${platform}', '${module}', 1, '${date}')
			`).run()
		}
	} catch (err) {
		console.error(err)
	}
}

export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env)
	}
}
