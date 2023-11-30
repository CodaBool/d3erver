import { Router } from 'itty-router'
const router = Router()

/*         Clients         */
// downloads ZIP after token validation

router.get('/', async (request, env) => {
	const url = new URL(request.url)
	const token = url.searchParams.get("token")
	const module = url.searchParams.get("module")
	const country = request.headers.get('cf-ipcountry')
	const agent = request.headers.get('user-agent')
	const ip = request.headers.get('x-real-ip')

	if (!token || !module) {
		// ============ DEBUG
		// console.log(`url missing a query, likely a bot. ip=${ip} agent=${agent} country=${country} token=${token} module=${module}`)
		return new Response('missing a query', { status: 400 })
	}

	const name = module.slice(0, -7)

	try {
		const tokenExists = await env.KV.get(token)
	
		if (!tokenExists) {
			console.log(`403 /GET expired token ${token} from ${ip} country=${country} agent=${agent}`)
			// ============ DEBUG
			await email("403 /GET", `expired token ${token} from ${ip} country=${country} agent=${agent}`, "ERROR")
			return new Response("expired token", { status: 403 })
		}
	
		const zip = await env.R2.get(module)
	
		if (zip === null) {
			console.error("Foundry client asked for module", module, "which does not exist")
			await email("404 /GET", `module ${module} does not exist`, "ERROR")
			return new Response(`module ${module} does not exist`, { status: 404 })
		}
	
		if (zip.status >= 400) {
			console.error(zip)
			await email("500 /GET", `couldn't get module ${module} from R2 ${JSON.stringify(zip, null, 2)}`, "ERROR")
			return new Response('Error fetching the zip file', { status: 500 })
		}
	
		await increment(env, "foundry", name)
	
		// Return the zip file
		return new Response(zip.body, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${name}.zip"`,
			}
		})
	} catch(err) {
		console.error("/GET", err, module)
		await email("500 /GET", typeof err === 'object' ? JSON.stringify(err, null ,2) : err, "ERROR")
		return new Response("server error", { status: 500 })
	}
})

/*         The Forge         */
// password based downloads by providing a secret in module.json "download" URL
// Forge removes the "download" URL prop, making this secure (TM)

router.get('/forge', async (request, env) => {
	const url = new URL(request.url)
	const module = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")

	// debug
	const country = request.headers.get('cf-ipcountry')
	const agent = request.headers.get('user-agent')
	const ip = request.headers.get('x-real-ip')
	// console.log(`country=${country} agent=${agent} ip=${ip}`)

	if (!secret || !module) {
		// ============ DEBUG
		console.log(`url missing a query, likely a bot. ip=${ip} agent=${agent} country=${country} secret=${secret} module=${module}`)
		// await email("400 /forge", `url missing a query ${url} req ${JSON.stringify(request, null, 2)}`, "DEBUG")
		return new Response('missing a query', { status: 400 })
	}

	if (secret !== env.FORGE_SECRET) {
		console.error(`403 /forge wrong secret ${secret} from ${ip} country=${country}`)
		await email("403 /forge", `wrong secret ${secret} from ${ip} country=${country}`, "ERROR")
		return new Response("unauthorized", { status: 403 })
	}

	try {
		const zip = await env.R2.get(module)
	
		if (zip === null) {
			console.error("Forge server asked for module", module, "which does not exist")
			await email("404 /forge", `module ${module} does not exist`, "ERROR")
			return new Response(`module ${module} does not exist`, { status: 404 })
		}
	
		if (zip.status >= 400) {
			console.error(zip)
			await email("500 /forge", `couldn't get module ${module} from R2 ${JSON.stringify(zip, null, 2)}`, "ERROR")
			return new Response('Error fetching the zip file', { status: 500 })
		}
	
		const name = module.slice(0, -7)
		await increment(env, "forge", name)
	
		return new Response(zip.body, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${name}.zip"`,
			}
		})
	} catch(err) {
		console.error("/forge", err, module)
		await email("500 /forge", typeof err === 'object' ? JSON.stringify(err, null ,2) : err, "ERROR")
		return new Response("server error", { status: 500 })
	}
})

/*         The Forge              */
// custom module.json for private packages, since a download and manifest contain secrets
// this cannot be public so it is dynamically created after validation

router.get('/manifest', async (request, env) => {
	const url = new URL(request.url)
	const moduleName = url.searchParams.get("module")
	const secret = url.searchParams.get("secret")

	// debug
	const country = request.headers.get('cf-ipcountry')
	const agent = request.headers.get('user-agent')
	const ip = request.headers.get('x-real-ip')

	// if (ip !== "15.235.53.129" || agent !== "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)" || country !== "CA") {
	// }

	if (!secret || !moduleName) {
		// ============ DEBUG
		console.log(`url missing a query, likely a bot. ip=${ip} agent=${agent} country=${country}`)
		return new Response('missing a query', { status: 400 })
	}

	if (secret !== env.FORGE_SECRET) {
		console.error(`403 /manifest wrong secret ${secret} from ${ip} country=${country}`)
		await email("403 /manifest", `wrong secret ${secret} from ${ip} country=${country}`, "ERROR")
		return new Response("unauthorized", { status: 403 })
	}

	try {
		// D1 will have values updated from module Github Actions
		const { data } = await env.D1.prepare("SELECT * FROM manifests").first()
		const template = JSON.parse(data)
	
		// append manifest and download props with secrets
		template.manifest = `https://d3erver.codabool.workers.dev/manifest?secret=${secret}&module=${moduleName}`
		template.download = `https://d3erver.codabool.workers.dev/forge?secret=${env.FORGE_SECRET}&module=terminal-v${template.version}`
	
		const secretJSON = JSON.stringify(template, null, 2)
	
		return new Response(secretJSON, {
			headers: {
				'Content-Type': 'application/json',
			}
		})
	} catch(err) {
		console.error("/manifest", err)
		await email("500 /manifest", typeof err === 'object' ? JSON.stringify(err, null ,2) : err, "ERROR")
		return new Response("server error", { status: 500 })
	}
})

/*         Foundry Server         */
// creates a token in KV and returns JSON with a timed download URL

router.post('/', async (req, env)=> {
	const body = await req.json()

	if (body?.api_key !== env.FOUNDRY_SECRET) {
		console.error("unauthorized", body)
		await email("403 /POST (Foundry)", `auth=${body?.api_key} ip=${req.headers.get('x-real-ip')} country=${req.headers.get('cf-ipcountry')}`, "WARN")
		return new Response("unauthorized", { status: 403 })
	}

	// 4h timed token
	const uuid = await crypto.randomUUID()

	try {
		await env.KV.put(uuid, body.user_id, { expirationTTL: 14400 })
	
		const data = JSON.stringify({
			download: `https://${env.DOMAIN}/?token=${uuid}&module=${body.package_name}-v${body.version}`,
			package_name: body.package_name,
			version: body.version,
		}, null, 2)
	
		return new Response(data, {
			headers: { 'Content-Type': 'application/json' }
		})
	} catch(err) {
		console.error("/POST", err, body)
		await email("500 /POST (Foundry)", typeof err === 'object' ? JSON.stringify(err, null ,2) : err, "ERROR")
		return new Response("server error", { status: 500 })
	}
})

// 404 for everything else
router.all('*', () => new Response('Not Found.', { status: 404 }))

// increment CloudFlare D1, SQLite for record keeping
async function increment(env, platform, module) {
	try {
		let date = new Date()
		date = date.getFullYear() + "-" + (date.getMonth() + 1)
		
		const { meta } = await env.D1.prepare(`UPDATE downloads SET total = total + 1 WHERE year_month = '${date}' and platform = '${platform}' AND module = '${module}'`).run()

		if (!meta.changes) {
			await env.D1.prepare(`INSERT OR IGNORE INTO downloads (platform, module, total, year_month) VALUES ('${platform}', '${module}', 1, '${date}')`).run()
		}
	} catch(err) {
		console.error("D1", err)
		await email("increment error", JSON.stringify(err, null, 2), "ERROR")
	}
}

async function email(subject, value, name) {
	const mail = await fetch("https://api.mailchannels.net/tx/v1/send", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			personalizations: [{
				to: [{ email: "codabool@pm.me", name: "CodaBool" }],
			}],
			from: {email: "d3erver@codabool.com", name },
			content: [{ type: 'text/plain', value }],
			subject,
		})
	})
	
	const text = await mail.text()
	if (!mail.ok || mail.status > 299) {
		console.error(`Error sending email: ${mail.status} ${mail.statusText} ${text}`)
		return
	}
	console.log("email =", mail.statusText)
}

export default {
	async fetch(request, env, ctx) {
		return router.handle(request, env)
	}
}
