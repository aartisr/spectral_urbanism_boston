FROM node:20-alpine

WORKDIR /app/web

COPY web/package*.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
	sh -ec 'if [ ! -s /root/.npmrc ]; then echo "Missing npm registry credentials. Provide a BuildKit secret named npmrc (usually your ~/.npmrc)." >&2; exit 1; fi; \
	registry=$(sed -n "s/^registry=//p" /root/.npmrc | head -n 1); \
	if [ -n "$registry" ] && [ "${registry%/}" = "$registry" ]; then registry="$registry/"; fi; \
	{ [ -n "$registry" ] && printf "registry=%s\n" "$registry"; grep -v "^registry=" /root/.npmrc; } > /tmp/npmrc.normalized; \
	if ! grep -q "^always-auth=" /tmp/npmrc.normalized; then echo "always-auth=true" >> /tmp/npmrc.normalized; fi; \
	export NPM_CONFIG_USERCONFIG=/tmp/npmrc.normalized; \
	npm install --fetch-retries=5 --fetch-retry-maxtimeout=120000'

COPY web .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
