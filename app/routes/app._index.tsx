import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [reglasActivas, totalPedidos] = await Promise.all([
    prisma.reglaPersonalizada.count({ where: { shop, activa: true } }),
    prisma.pedidoCustom.count({ where: { shop } }),
  ]);

  return { reglasActivas, totalPedidos };
};

export default function Dashboard() {
  const { reglasActivas, totalPedidos } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Custom Size App">
      <s-button slot="primary-action" href="/app/reglas/nueva">
        Nueva regla
      </s-button>

      <s-section heading="Reglas activas">
        <s-stack direction="block" gap="base">
          <s-text variant="heading-3xl">{reglasActivas}</s-text>
          <s-paragraph>
            Reglas de medidas personalizadas actualmente activas en la tienda.
          </s-paragraph>
          <s-link href="/app/reglas">Ver todas las reglas →</s-link>
        </s-stack>
      </s-section>

      <s-section heading="Pedidos con medida personalizada">
        <s-stack direction="block" gap="base">
          <s-text variant="heading-3xl">{totalPedidos}</s-text>
          <s-paragraph>
            Total de pedidos registrados con medidas y precios personalizados.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
