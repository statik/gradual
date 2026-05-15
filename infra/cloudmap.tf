# Private DNS so the app can reach Electric at a stable name without
# exposing Electric through the public ALB.
resource "aws_service_discovery_private_dns_namespace" "this" {
  name = "${local.name}.internal"
  vpc  = aws_vpc.this.id
}

resource "aws_service_discovery_service" "electric" {
  name = "electric"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      type = "A"
      ttl  = 10
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

locals {
  electric_internal_url = "http://electric.${aws_service_discovery_private_dns_namespace.this.name}:${local.electric_port}"
}
