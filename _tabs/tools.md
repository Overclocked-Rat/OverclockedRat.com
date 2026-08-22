---
icon: fas fa-toolbox
order: 1
---

Everything here runs entirely in your browser — nothing you enter is ever uploaded anywhere.

<div class="tile-grid mt-4">
  {% assign tools = site.data.tools %}
  {% if tools and tools.size > 0 %}
    {% for tool in tools %}
      <a href="{{ tool.url | relative_url }}" class="card-wrapper card tile">
        <i class="{{ tool.icon | default: 'fas fa-screwdriver-wrench' }} tile-icon" aria-hidden="true"></i>
        <span class="tile-name">{{ tool.name }}</span>
        {% assign blurb = tool.tagline | default: tool.description %}
        {% if blurb %}
          <span class="tile-tagline">{{ blurb }}</span>
        {% endif %}
      </a>
    {% endfor %}
  {% else %}
    <p class="text-muted tile-grid-empty">Tools are coming soon.</p>
  {% endif %}
</div>
