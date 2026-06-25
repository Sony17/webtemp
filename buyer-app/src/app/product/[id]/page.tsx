import { notFound } from "next/navigation";
import { getProductById, getRelatedProducts } from "@/services/catalog";
import { ProductDetailClient } from "./ProductDetailClient";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  const related = await getRelatedProducts(product);

  return <ProductDetailClient product={product} related={related} />;
}
