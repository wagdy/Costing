# syntax=docker/dockerfile:1

# Costing & Financials as one image: the Angular app built, then served by the .NET API from its
# wwwroot.
#
#   docker build -t costing .
#   docker run -p 8080:8080 -e DATABASE_URL=postgres://… -e Auth__SigningKey=… costing
#
# On Railway: the API listens on Railway's PORT, behind its HTTPS domain. See docs/deploy-railway.md.

# ---- 1. The Angular app ----
FROM node:22-bookworm-slim AS app
WORKDIR /src/frontend
ENV NG_CLI_ANALYTICS=false CI=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Through scripts/build.mjs: `ng build` itself never exits after building (see the script).
RUN node scripts/build.mjs --configuration production --output-path /app-dist

# ---- 2. The API, with the app in its wwwroot ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
# The projects alone first, so a code change does not download the packages again.
COPY backend/src/Costing.Domain/Costing.Domain.csproj backend/src/Costing.Domain/
COPY backend/src/Costing.Application/Costing.Application.csproj backend/src/Costing.Application/
COPY backend/src/Costing.Infrastructure/Costing.Infrastructure.csproj backend/src/Costing.Infrastructure/
COPY backend/src/Costing.Api/Costing.Api.csproj backend/src/Costing.Api/
RUN dotnet restore backend/src/Costing.Api/Costing.Api.csproj
COPY backend/src/ backend/src/
RUN dotnet publish backend/src/Costing.Api/Costing.Api.csproj -c Release -o /publish --no-restore /p:UseAppHost=false
COPY --from=app /app-dist/browser/ /publish/wwwroot/

# ---- 3. The runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=api /publish ./

# Production; behind the platform's proxy, the client's own address and scheme from its
# forwarded headers (the sign-in limits are per address). PORT, the database, the signing key and
# the first manager come from the platform's variables, never from this file.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    PORT=8080

# The web port (PORT): the app and its API.
EXPOSE 8080

USER $APP_UID
ENTRYPOINT ["dotnet", "Costing.Api.dll"]
