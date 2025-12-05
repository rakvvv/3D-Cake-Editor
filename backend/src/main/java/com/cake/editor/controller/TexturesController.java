package com.cake.editor.controller;

import com.cake.editor.model.TextureIndex;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;

@RestController
@RequestMapping(path = "/api/textures", produces = MediaType.APPLICATION_JSON_VALUE)
public class TexturesController {

    private final ObjectMapper objectMapper;
    private final Resource texturesResource = new ClassPathResource("textures.json");

    public TexturesController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public TextureIndex getTextures() throws IOException {
        try (InputStream inputStream = texturesResource.getInputStream()) {
            return objectMapper.readValue(inputStream, TextureIndex.class);
        }
    }
}
