require 'digest'
require 'json'
require 'pathname'

module OkfPackageDigest
  EXCLUDED_DIRECTORIES = %w[.cache coverage dist node_modules target].freeze

  module_function

  def workspace_packages(workspace_root)
    %w[apps packages].flat_map do |directory|
      workspace_root.glob("#{directory}/*/package.json")
    end.sort.map do |manifest|
      data = JSON.parse(manifest.read(encoding: 'UTF-8'))
      name = data['name']
      raise "package manifest has no name: #{manifest}" unless name.is_a?(String) && !name.empty?
      [name, manifest.dirname]
    end
  end

  def digest(package_root)
    value = Digest::SHA256.new
    files(package_root).each do |path|
      relative = path.relative_path_from(package_root).to_s
      value.update(relative)
      value.update("\0")
      value.update(path.binread)
      value.update("\0")
    end
    "sha256:#{value.hexdigest}"
  end

  def files(package_root)
    package_root.glob('**/*', File::FNM_DOTMATCH).select(&:file?).reject do |path|
      relative = path.relative_path_from(package_root)
      relative.each_filename.any? { |part| EXCLUDED_DIRECTORIES.include?(part) } ||
        path.basename.to_s == '.DS_Store' ||
        path.extname == '.tsbuildinfo'
    end.sort
  end
end
