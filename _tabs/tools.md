---
icon: fas fa-toolbox
order: 1
---

Everything here runs entirely in your browser — nothing you enter is ever uploaded anywhere.

<div class="tools-list mt-4">
  {% assign tools = site.data.tools %}
  {% if tools and tools.size > 0 %}
    {% for tool in tools %}
      <article class="card-wrapper card mb-3">
        <a href="{{ tool.url | relative_url }}" class="post-preview row g-0">
          <div class="col-12">
            <div class="card-body">
              <h2 class="card-title my-1">{{ tool.name }}</h2>
              <p class="card-text text-muted mb-0">{{ tool.description }}</p>
            </div>
          </div>
        </a>
      </article>
    {% endfor %}
  {% else %}
    <p class="text-muted">Tools are coming soon.</p>
  {% endif %}
</div>
