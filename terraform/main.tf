###############################################################################
# Oracle Cloud Free Tier — Financial Manager
#
# Provisions:
#   • VCN + public subnet + internet gateway
#   • Security rules for ports 22 (SSH) and 3000 (app)
#   • VM.Standard.E2.1.Micro (Always Free, AMD, 1 OCPU / 1 GB)
#   • cloud-init bootstraps Docker Compose + app
###############################################################################

terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

# ── Networking ──────────────────────────────────────────────────────────────

resource "oci_core_vcn" "fm_vcn" {
  compartment_id = var.compartment_ocid
  display_name   = "fm-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "fmvcn"
}

resource "oci_core_internet_gateway" "fm_igw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.fm_vcn.id
  display_name   = "fm-igw"
  enabled        = true
}

resource "oci_core_route_table" "fm_rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.fm_vcn.id
  display_name   = "fm-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.fm_igw.id
  }
}

resource "oci_core_security_list" "fm_sl" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.fm_vcn.id
  display_name   = "fm-sl"

  # Allow all outbound
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  # SSH (for initial setup / debugging)
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  # App
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 3000
      max = 3000
    }
  }
}

resource "oci_core_subnet" "fm_subnet" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.fm_vcn.id
  display_name      = "fm-subnet"
  cidr_block        = "10.0.1.0/24"
  dns_label         = "fmsubnet"
  route_table_id    = oci_core_route_table.fm_rt.id
  security_list_ids = [oci_core_security_list.fm_sl.id]
}

# ── Compute ─────────────────────────────────────────────────────────────────

# Lookup the latest Oracle Linux 8 image (free tier eligible)
data "oci_core_images" "oracle_linux" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "8"
  shape                    = "VM.Standard.E2.1.Micro"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "fm_instance" {
  compartment_id      = var.compartment_ocid
  availability_domain = var.availability_domain
  display_name        = "financial-manager"
  shape               = "VM.Standard.E2.1.Micro"

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.oracle_linux.images[0].id
    boot_volume_size_in_gbs = 50
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.fm_subnet.id
    assign_public_ip = true
    display_name     = "fm-vnic"
  }

  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
    user_data           = base64encode(templatefile("${path.module}/cloud-init.yml", {
      repo_url          = var.repo_url
      session_secret    = var.session_secret
      registration_code = var.registration_code
    }))
  }
}
