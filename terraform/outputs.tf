output "instance_public_ip" {
  description = "Public IP of the Financial Manager instance"
  value       = oci_core_instance.fm_instance.public_ip
}

output "app_url" {
  description = "URL to access the app"
  value       = "http://${oci_core_instance.fm_instance.public_ip}:3000"
}
