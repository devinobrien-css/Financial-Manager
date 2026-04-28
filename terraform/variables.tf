variable "tenancy_ocid" {
  description = "OCID of your OCI tenancy"
  type        = string
}

variable "user_ocid" {
  description = "OCID of the OCI user running Terraform"
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API key"
  type        = string
}

variable "private_key_path" {
  description = "Path to the OCI API private key PEM file"
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "OCI region (e.g. us-ashburn-1)"
  type        = string
  default     = "us-ashburn-1"
}

variable "compartment_ocid" {
  description = "OCID of the compartment to deploy into (use root compartment = tenancy_ocid)"
  type        = string
}

variable "availability_domain" {
  description = "Availability domain name (e.g. IWjO:US-ASHBURN-AD-1)"
  type        = string
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key to install on the instance"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "session_secret" {
  description = "Random secret used to sign session tokens (min 32 chars)"
  type        = string
  sensitive   = true
}

variable "registration_code" {
  description = "Optional: if set, users must supply this code when registering"
  type        = string
  sensitive   = true
  default     = ""
}

variable "repo_url" {
  description = "Git URL of this repository (used by cloud-init to clone the app)"
  type        = string
}
