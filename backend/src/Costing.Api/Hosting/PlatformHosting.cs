namespace Costing.Api.Hosting;

// On a hosting platform that gives the app its port in PORT (Railway, Render, Heroku): the API
// listens there on every address. With no PORT, the configuration's Urls as they are.
internal static class PlatformHosting
{
    public const string PortVariable = "PORT";

    public static void ListenOnPlatformPort(this WebApplicationBuilder builder)
    {
        if (!int.TryParse(builder.Configuration[PortVariable], out var webPort) || webPort <= 0)
            return;
        builder.WebHost.UseUrls($"http://0.0.0.0:{webPort}");
    }
}
