#!/usr/bin/env ruby

require 'pathname'
require_relative 'package_digest'

workspace_root = Pathname(ARGV.fetch(0, '.')).expand_path
abort "workspace root does not exist: #{workspace_root}" unless workspace_root.directory?

OkfPackageDigest.workspace_packages(workspace_root).each do |name, package_root|
  puts [name, OkfPackageDigest.digest(package_root), package_root.relative_path_from(workspace_root)].join("\t")
end
